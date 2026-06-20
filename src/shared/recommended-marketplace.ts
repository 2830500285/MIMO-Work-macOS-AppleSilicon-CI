export type RecommendedGithubDirectory = {
  owner: string
  repo: string
  ref: string
  path: string
}

export type RecommendedSkillPackage = {
  id: string
  titleKey: string
  descriptionKey: string
  sourceLabelKey: string
  sourceUrl: string
  destinationName: string
  github: RecommendedGithubDirectory
}

export const RECOMMENDED_SKILL_PACKAGES: readonly RecommendedSkillPackage[] = [
  {
    id: 'hermes-software-development',
    titleKey: 'pluginSkillHermesSoftwareTitle',
    descriptionKey: 'pluginSkillHermesSoftwareDesc',
    sourceLabelKey: 'pluginSourceHermesOfficial',
    sourceUrl: 'https://github.com/NousResearch/hermes-agent/tree/main/skills/software-development',
    destinationName: 'hermes-agent/software-development',
    github: {
      owner: 'NousResearch',
      repo: 'hermes-agent',
      ref: 'main',
      path: 'skills/software-development'
    }
  },
  {
    id: 'hermes-research',
    titleKey: 'pluginSkillHermesResearchTitle',
    descriptionKey: 'pluginSkillHermesResearchDesc',
    sourceLabelKey: 'pluginSourceHermesOfficial',
    sourceUrl: 'https://github.com/NousResearch/hermes-agent/tree/main/skills/research',
    destinationName: 'hermes-agent/research',
    github: {
      owner: 'NousResearch',
      repo: 'hermes-agent',
      ref: 'main',
      path: 'skills/research'
    }
  },
  {
    id: 'hermes-productivity',
    titleKey: 'pluginSkillHermesProductivityTitle',
    descriptionKey: 'pluginSkillHermesProductivityDesc',
    sourceLabelKey: 'pluginSourceHermesOfficial',
    sourceUrl: 'https://github.com/NousResearch/hermes-agent/tree/main/skills/productivity',
    destinationName: 'hermes-agent/productivity',
    github: {
      owner: 'NousResearch',
      repo: 'hermes-agent',
      ref: 'main',
      path: 'skills/productivity'
    }
  },
  {
    id: 'hermes-creative',
    titleKey: 'pluginSkillHermesCreativeTitle',
    descriptionKey: 'pluginSkillHermesCreativeDesc',
    sourceLabelKey: 'pluginSourceHermesOfficial',
    sourceUrl: 'https://github.com/NousResearch/hermes-agent/tree/main/skills/creative',
    destinationName: 'hermes-agent/creative',
    github: {
      owner: 'NousResearch',
      repo: 'hermes-agent',
      ref: 'main',
      path: 'skills/creative'
    }
  },
  {
    id: 'hermes-optional-mcp',
    titleKey: 'pluginSkillHermesMcpTitle',
    descriptionKey: 'pluginSkillHermesMcpDesc',
    sourceLabelKey: 'pluginSourceHermesOfficial',
    sourceUrl: 'https://github.com/NousResearch/hermes-agent/tree/main/optional-skills/mcp',
    destinationName: 'hermes-agent/optional-mcp',
    github: {
      owner: 'NousResearch',
      repo: 'hermes-agent',
      ref: 'main',
      path: 'optional-skills/mcp'
    }
  }
]

export function findRecommendedSkillPackage(id: string): RecommendedSkillPackage | undefined {
  const normalized = id.trim()
  return RECOMMENDED_SKILL_PACKAGES.find((item) => item.id === normalized)
}
