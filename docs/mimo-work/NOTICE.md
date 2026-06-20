# MIMO Work Notices

MIMO Work is a derivative desktop workbench that combines a Kun-based shell with a MiMo-Code-based agent runtime.

## Upstream Sources

- Kun shell reference: https://github.com/KunAgent/Kun
- MiMo-Code runtime reference: https://github.com/XiaomiMiMo/MiMo-Code

## Credential Handling

MiMo recharge keys and Tokenplan keys are sensitive credentials. They must not be committed, printed in logs, stored in test snapshots, or embedded in packaged resources. Development smoke tests should pass credentials through local environment variables or local auth files only.

## Distribution Assumption

The project owner has confirmed authorization to build and publish this derivative work. Keep upstream notices and license files with any public distribution.
