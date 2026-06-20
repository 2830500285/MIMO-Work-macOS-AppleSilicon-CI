const ASPECT_RATIOS = new Set(['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'])
const SIZE_TIERS: Record<string, number> = { '1K': 1024, '2K': 2048 }
const SIZE_STEP = 64
const MIN_EDGE = 256

export type GeneratedImage = { data: Buffer; mimeType: string }

export type ImageGenRequest = {
  prompt: string
  model: string
  size?: string
  timeoutMs: number
  signal: AbortSignal
}

export type ImageGenEditRequest = ImageGenRequest & {
  images: { name: string; mimeType: string; data: Buffer }[]
}

type ImagesApiPayload = { data?: { b64_json?: string; url?: string }[] }

export interface ImageGenClient {
  id: string
  generate(request: ImageGenRequest): Promise<GeneratedImage>
  edit(request: ImageGenEditRequest): Promise<GeneratedImage>
}

export class ImageGenHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string
  ) {
    super(`HTTP ${status}: ${body}`)
  }
}

export function describeNetworkError(error: unknown): string {
  const parts: string[] = []
  let current: unknown = error
  for (let depth = 0; depth < 5 && current != null; depth += 1) {
    if (current instanceof AggregateError && current.errors.length > 0) {
      current = current.errors[0]
      continue
    }
    if (!(current instanceof Error)) {
      parts.push(String(current))
      break
    }
    const code = (current as { code?: unknown }).code
    const codeText = typeof code === 'string' ? code : ''
    const message = current.message.trim()
    if (message) {
      parts.push(codeText && !message.includes(codeText) ? `${message} (${codeText})` : message)
    } else if (codeText) {
      parts.push(codeText)
    }
    current = current.cause
  }
  const unique = parts.filter((part, index) => parts.indexOf(part) === index)
  return unique.join(': ') || 'unknown network error'
}

export function mapImageSize(
  aspectRatio: string | undefined,
  imageSize: string | undefined,
  defaultSize: string | undefined
): string | undefined {
  if (!aspectRatio && !imageSize) return defaultSize
  const tier = SIZE_TIERS[imageSize ?? ''] ?? SIZE_TIERS['1K']
  const parsed = parseRatio(aspectRatio)
  if (!parsed) return `${tier}x${tier}`
  const { w, h } = parsed
  if (w === h) return `${tier}x${tier}`
  const short = Math.max(MIN_EDGE, Math.round((tier * Math.min(w, h)) / Math.max(w, h) / SIZE_STEP) * SIZE_STEP)
  return w > h ? `${tier}x${short}` : `${short}x${tier}`
}

export function createImageGenClient(config: {
  baseUrl?: string
  apiKey?: string
}): ImageGenClient {
  return new OpenAiCompatImageClient(config.baseUrl ?? '', config.apiKey ?? '')
}

export function detectImage(buffer: Buffer): { mimeType: string; width?: number; height?: number } | null {
  if (buffer.length >= 24 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return { mimeType: 'image/png', width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mimeType: 'image/jpeg' }
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return { mimeType: 'image/webp' }
  }
  return null
}

function parseRatio(aspectRatio: string | undefined): { w: number; h: number } | null {
  if (!aspectRatio || !ASPECT_RATIOS.has(aspectRatio)) return null
  const [w, h] = aspectRatio.split(':').map(Number)
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null
  return { w, h }
}

function imageFetchFailure(
  url: string,
  error: unknown,
  request: { timeoutMs: number }
): Error {
  const target = url.split('?')[0]
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return new Error(`image request to ${target} timed out after ${request.timeoutMs}ms`, { cause: error })
  }
  if (error instanceof DOMException && error.name === 'AbortError') {
    return new Error(`image request to ${target} was canceled`, { cause: error })
  }
  return new Error(`image request to ${target} failed: ${describeNetworkError(error)}`, { cause: error })
}

function openAiCompatImageUrl(
  baseUrl: string,
  endpoint: 'generations' | 'edits'
): string {
  const path = `images/${endpoint}`
  let normalized = trimTrailingSlashes(baseUrl.trim())
  if (!normalized) return `/v1/${path}`
  const lower = normalized.toLowerCase()
  if (lower.endsWith(`/${path}`)) return normalized
  for (const known of ['images/generations', 'images/edits']) {
    if (lower.endsWith(`/${known}`)) {
      normalized = trimTrailingSlashes(normalized.slice(0, -known.length))
      break
    }
  }
  const lastSegment = normalized.split('/').pop()?.toLowerCase() ?? ''
  if (isVersionSegment(lastSegment)) return `${normalized}/${path}`
  return `${normalized}/v1/${path}`
}

class OpenAiCompatImageClient implements ImageGenClient {
  readonly id = 'openai-compat'
  private readonly baseUrl: string

  constructor(
    baseUrl: string,
    private readonly apiKey: string
  ) {
    this.baseUrl = trimTrailingSlashes(baseUrl)
  }

  async generate(request: ImageGenRequest): Promise<GeneratedImage> {
    const body = (includeResponseFormat: boolean) =>
      JSON.stringify({
        model: request.model,
        prompt: request.prompt,
        n: 1,
        ...(request.size ? { size: request.size } : {}),
        ...(includeResponseFormat ? { response_format: 'b64_json' } : {})
      })
    return this.requestImage(
      openAiCompatImageUrl(this.baseUrl, 'generations'),
      (includeResponseFormat) => ({
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: body(includeResponseFormat)
      }),
      request
    )
  }

  async edit(request: ImageGenEditRequest): Promise<GeneratedImage> {
    const buildForm = (includeResponseFormat: boolean) => {
      const form = new FormData()
      form.set('model', request.model)
      form.set('prompt', request.prompt)
      if (request.size) form.set('size', request.size)
      if (includeResponseFormat) form.set('response_format', 'b64_json')
      const field = request.images.length > 1 ? 'image[]' : 'image'
      for (const image of request.images) {
        form.append(field, new Blob([new Uint8Array(image.data)], { type: image.mimeType }), image.name)
      }
      return form
    }
    return this.requestImage(
      openAiCompatImageUrl(this.baseUrl, 'edits'),
      (includeResponseFormat) => ({
        headers: { Authorization: `Bearer ${this.apiKey}` },
        body: buildForm(includeResponseFormat)
      }),
      request
    )
  }

  private async requestImage(
    url: string,
    init: (includeResponseFormat: boolean) => { headers: Record<string, string>; body: string | FormData },
    request: { timeoutMs: number; signal: AbortSignal }
  ): Promise<GeneratedImage> {
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(request.timeoutMs)])
    const post = async (includeResponseFormat: boolean): Promise<Response> => {
      try {
        return await fetch(url, { method: 'POST', ...init(includeResponseFormat), signal })
      } catch (error) {
        throw imageFetchFailure(url, error, request)
      }
    }
    let response = await post(true)
    if (!response.ok && response.status >= 400 && response.status < 500) {
      const errorBody = await response.text()
      if (!/response_format/i.test(errorBody)) throw new ImageGenHttpError(response.status, errorBody)
      response = await post(false)
    }
    if (!response.ok) {
      throw new ImageGenHttpError(response.status, await response.text())
    }
    const payload = (await response.json()) as ImagesApiPayload
    const entry = payload.data?.[0]
    if (entry?.b64_json) {
      return { data: Buffer.from(entry.b64_json, 'base64'), mimeType: 'image/png' }
    }
    if (entry?.url) {
      let download: Response
      try {
        download = await fetch(entry.url, { signal })
      } catch (error) {
        throw imageFetchFailure(entry.url, error, request)
      }
      if (!download.ok) throw new ImageGenHttpError(download.status, await download.text())
      const mimeType = download.headers.get('content-type')?.split(';')[0] || 'image/png'
      return { data: Buffer.from(await download.arrayBuffer()), mimeType }
    }
    throw new Error('image provider returned no image data')
  }
}

function trimTrailingSlashes(value: string): string {
  let end = value.length
  while (end > 0 && value.charCodeAt(end - 1) === 47) end -= 1
  return end === value.length ? value : value.slice(0, end)
}

function isVersionSegment(value: string): boolean {
  if (value.length < 2 || value[0] !== 'v') return false
  for (let index = 1; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code < 48 || code > 57) return false
  }
  return true
}
