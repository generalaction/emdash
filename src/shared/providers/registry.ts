export const PROVIDER_IDS = [
  'codex',
  'claude',
  'qwen',
  'droid',
  'gemini',
  'cursor',
  'copilot',
  'amp',
  'opencode',
  'charm',
  'auggie',
  'goose',
  'kimi',
  'kiro',
  'rovo',
  'cline',
] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export type ProviderDefinition = {
  id: ProviderId;
  name: string;
  docUrl?: string;
  installCommand?: string;
  commands?: string[];
  versionArgs?: string[];
  detectable?: boolean;
};

export const PROVIDERS: ProviderDefinition[] = [
  {
    id: 'codex',
    name: 'Codex',
    docUrl: 'https://github.com/openai/codex',
    installCommand: 'npm install -g @openai/codex',
    commands: ['codex'],
    versionArgs: ['--version'],
  },
  {
    id: 'claude',
    name: 'Claude Code',
    docUrl: 'https://docs.anthropic.com/claude/docs/claude-code',
    installCommand: 'npm install -g @anthropic-ai/claude-code',
    commands: ['claude'],
    versionArgs: ['--version'],
  },
  {
    id: 'cursor',
    name: 'Cursor',
    docUrl: 'https://cursor.sh',
    installCommand: 'curl https://cursor.com/install -fsS | bash',
    commands: ['cursor-agent', 'cursor'],
    versionArgs: ['--version'],
  },
  {
    id: 'gemini',
    name: 'Gemini',
    docUrl: 'https://github.com/google-gemini/gemini-cli',
    installCommand: 'npm install -g @google/gemini-cli',
    commands: ['gemini'],
    versionArgs: ['--version'],
  },
  {
    id: 'qwen',
    name: 'Qwen Code',
    docUrl: 'https://github.com/QwenLM/qwen-code',
    installCommand: 'npm install -g @qwen-code/qwen-code',
    commands: ['qwen'],
    versionArgs: ['--version'],
  },
  {
    id: 'droid',
    name: 'Droid',
    docUrl: 'https://docs.factory.ai/cli/getting-started/quickstart',
    installCommand: 'curl -fsSL https://app.factory.ai/cli | sh',
    commands: ['droid'],
    versionArgs: ['--version'],
  },
  {
    id: 'amp',
    name: 'Amp',
    docUrl: 'https://ampcode.com/manual#install',
    installCommand: 'npm install -g @sourcegraph/amp@latest',
    commands: ['amp'],
    versionArgs: ['--version'],
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    docUrl: 'https://opencode.ai/docs/cli/',
    installCommand: 'npm install -g opencode-ai',
    commands: ['opencode'],
    versionArgs: ['--version'],
  },
  {
    id: 'copilot',
    name: 'GitHub Copilot',
    docUrl: 'https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli',
    installCommand: 'npm install -g @github/copilot',
    commands: ['copilot'],
    versionArgs: ['--version'],
  },
  {
    id: 'charm',
    name: 'Charm',
    docUrl: 'https://github.com/charmbracelet/crush',
    installCommand: 'npm install -g @charmland/crush',
    commands: ['crush'],
    versionArgs: ['--version'],
  },
  {
    id: 'auggie',
    name: 'Auggie',
    docUrl: 'https://docs.augmentcode.com/cli/overview',
    installCommand: 'npm install -g @augmentcode/auggie',
    commands: ['auggie'],
    versionArgs: ['--version'],
  },
  {
    id: 'goose',
    name: 'Goose',
    docUrl: 'https://block.github.io/goose/docs/quickstart/',
    installCommand:
      'curl -fsSL https://github.com/block/goose/releases/download/stable/download_cli.sh | bash',
    detectable: false,
  },
  {
    id: 'kimi',
    name: 'Kimi',
    docUrl: 'https://www.kimi.com/coding/docs/en/kimi-cli.html',
    installCommand: 'uv tool install --python 3.13 kimi-cli',
    commands: ['kimi'],
    versionArgs: ['--help'],
  },
  {
    id: 'kiro',
    name: 'Kiro (AWS)',
    docUrl: 'https://kiro.dev/docs/cli/',
    installCommand: 'curl -fsSL https://cli.kiro.dev/install | bash',
    commands: ['kiro-cli', 'kiro'],
    versionArgs: ['--version'],
  },
  {
    id: 'rovo',
    name: 'Rovo Dev (Atlassian)',
    docUrl: 'https://support.atlassian.com/rovo/docs/install-and-run-rovo-dev-cli-on-your-device/',
    installCommand: 'acli rovodev auth login',
    commands: ['rovodev', 'acli'],
    versionArgs: ['--version'],
  },
  {
    id: 'cline',
    name: 'Cline',
    docUrl: 'https://docs.cline.bot/cline-cli/overview',
    installCommand: 'npm install -g cline',
    commands: ['cline'],
    versionArgs: ['help'],
  },
];

const PROVIDER_MAP = new Map<string, ProviderDefinition>(
  PROVIDERS.map((provider) => [provider.id, provider])
);

export function getProvider(id: ProviderId): ProviderDefinition | undefined {
  return PROVIDER_MAP.get(id);
}

export function getInstallCommandForProvider(id: ProviderId): string | null {
  return PROVIDER_MAP.get(id)?.installCommand ?? null;
}

/**
 * Validates if a string is a valid provider ID.
 * @param value - The value to validate
 * @returns true if the value is a valid provider ID, false otherwise
 */
export function isValidProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && PROVIDER_IDS.includes(value as ProviderId);
}

export function getDocUrlForProvider(id: ProviderId): string | null {
  return PROVIDER_MAP.get(id)?.docUrl ?? null;
}

export function listDetectableProviders(): ProviderDefinition[] {
  return PROVIDERS.filter((provider) => provider.detectable !== false && provider.commands?.length);
}
