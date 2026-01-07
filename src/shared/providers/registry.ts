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
  'kilocode',
  'kiro',
  'rovo',
  'cline',
  'continue',
  'codebuff',
  'mistral',
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
  cli?: string;
  autoApproveFlag?: string;
  initialPromptFlag?: string;
  resumeFlag?: string;
  defaultArgs?: string[];
  planActivateCommand?: string;
  autoStartCommand?: string;
  icon?: string;
  terminalOnly?: boolean;
};

export const PROVIDERS: ProviderDefinition[] = [
  {
    id: 'codex',
    name: 'Codex',
    docUrl: 'https://github.com/openai/codex',
    installCommand: 'npm install -g @openai/codex',
    commands: ['codex'],
    versionArgs: ['--version'],
    cli: 'codex',
    autoApproveFlag: '--full-auto',
    initialPromptFlag: '',
    icon: 'openai.png',
    terminalOnly: true,
  },
  {
    id: 'claude',
    name: 'Claude Code',
    docUrl: 'https://docs.anthropic.com/claude/docs/claude-code',
    installCommand: 'npm install -g @anthropic-ai/claude-code',
    commands: ['claude'],
    versionArgs: ['--version'],
    cli: 'claude',
    autoApproveFlag: '--dangerously-skip-permissions',
    initialPromptFlag: '',
    resumeFlag: '-c -r',
    planActivateCommand: '/plan',
    icon: 'claude.png',
    terminalOnly: true,
  },
  {
    id: 'cursor',
    name: 'Cursor',
    docUrl: 'https://cursor.sh',
    installCommand: 'curl https://cursor.com/install -fsS | bash',
    commands: ['cursor-agent', 'cursor'],
    versionArgs: ['--version'],
    cli: 'cursor-agent',
    autoApproveFlag: '-p',
    initialPromptFlag: '',
    icon: 'cursorlogo.png',
    terminalOnly: true,
  },
  {
    id: 'gemini',
    name: 'Gemini',
    docUrl: 'https://github.com/google-gemini/gemini-cli',
    installCommand: 'npm install -g @google/gemini-cli',
    commands: ['gemini'],
    versionArgs: ['--version'],
    cli: 'gemini',
    autoApproveFlag: '--yolomode',
    initialPromptFlag: '-i',
    resumeFlag: '--resume',
    icon: 'gemini.png',
    terminalOnly: true,
  },
  {
    id: 'qwen',
    name: 'Qwen Code',
    docUrl: 'https://github.com/QwenLM/qwen-code',
    installCommand: 'npm install -g @qwen-code/qwen-code',
    commands: ['qwen'],
    versionArgs: ['--version'],
    cli: 'qwen',
    autoApproveFlag: '--yolo',
    initialPromptFlag: '-i',
    resumeFlag: '--continue',
    icon: 'qwen.png',
    terminalOnly: true,
  },
  {
    id: 'droid',
    name: 'Droid',
    docUrl: 'https://docs.factory.ai/cli/getting-started/quickstart',
    installCommand: 'curl -fsSL https://app.factory.ai/cli | sh',
    commands: ['droid'],
    versionArgs: ['--version'],
    cli: 'droid',
    initialPromptFlag: '',
    icon: 'factorydroid.png',
    terminalOnly: true,
  },
  {
    id: 'amp',
    name: 'Amp',
    docUrl: 'https://ampcode.com/manual#install',
    installCommand: 'npm install -g @sourcegraph/amp@latest',
    commands: ['amp'],
    versionArgs: ['--version'],
    cli: 'amp',
    icon: 'ampcode.png',
    terminalOnly: true,
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    docUrl: 'https://opencode.ai/docs/cli/',
    installCommand: 'npm install -g opencode-ai',
    commands: ['opencode'],
    versionArgs: ['--version'],
    cli: 'opencode',
    initialPromptFlag: '--prompt',
    icon: 'opencode.png',
    terminalOnly: true,
  },
  {
    id: 'copilot',
    name: 'GitHub Copilot',
    docUrl: 'https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli',
    installCommand: 'npm install -g @github/copilot',
    commands: ['copilot'],
    versionArgs: ['--version'],
    cli: 'copilot',
    icon: 'ghcopilot.png',
    terminalOnly: true,
  },
  {
    id: 'charm',
    name: 'Charm',
    docUrl: 'https://github.com/charmbracelet/crush',
    installCommand: 'npm install -g @charmland/crush',
    commands: ['crush'],
    versionArgs: ['--version'],
    cli: 'crush',
    icon: 'charm.png',
    terminalOnly: true,
  },
  {
    id: 'auggie',
    name: 'Auggie',
    docUrl: 'https://docs.augmentcode.com/cli/overview',
    installCommand: 'npm install -g @augmentcode/auggie',
    commands: ['auggie'],
    versionArgs: ['--version'],
    cli: 'auggie',
    initialPromptFlag: '',
    // otherwise user is prompted each time before prompt is passed
    defaultArgs: ['--allow-indexing'],
    icon: 'augmentcode.png',
    terminalOnly: true,
  },
  {
    id: 'goose',
    name: 'Goose',
    docUrl: 'https://block.github.io/goose/docs/quickstart/',
    installCommand:
      'curl -fsSL https://github.com/block/goose/releases/download/stable/download_cli.sh | bash',
    detectable: false,
    cli: 'goose',
    // run subcommand with -s for interactive mode after initial prompt
    defaultArgs: ['run', '-s'],
    initialPromptFlag: '-t',
    icon: 'goose.png',
    terminalOnly: true,
  },
  {
    id: 'kimi',
    name: 'Kimi',
    docUrl: 'https://www.kimi.com/coding/docs/en/kimi-cli.html',
    installCommand: 'uv tool install kimi-cli',
    commands: ['kimi'],
    versionArgs: ['--version'],
    cli: 'kimi',
    initialPromptFlag: '-c',
    icon: 'kimi.png',
    terminalOnly: true,
  },
  {
    id: 'kilocode',
    name: 'Kilocode',
    docUrl: 'https://kilo.ai/docs/cli',
    installCommand: 'npm install -g @kilocode/cli',
    commands: ['kilocode'],
    versionArgs: ['--version'],
    cli: 'kilocode',
    autoApproveFlag: '--auto',
    initialPromptFlag: '',
    resumeFlag: '--continue',
    icon: 'kilocode.png',
    terminalOnly: true,
  },
  {
    id: 'kiro',
    name: 'Kiro (AWS)',
    docUrl: 'https://kiro.dev/docs/cli/',
    installCommand: 'curl -fsSL https://cli.kiro.dev/install | bash',
    commands: ['kiro-cli', 'kiro'],
    versionArgs: ['--version'],
    cli: 'kiro-cli',
    defaultArgs: ['chat'],
    initialPromptFlag: '',
    icon: 'kiro.png',
    terminalOnly: true,
  },
  {
    id: 'rovo',
    name: 'Rovo Dev (Atlassian)',
    docUrl: 'https://support.atlassian.com/rovo/docs/install-and-run-rovo-dev-cli-on-your-device/',
    installCommand: 'acli rovodev auth login',
    commands: ['rovodev', 'acli'],
    versionArgs: ['--version'],
    autoApproveFlag: '--yolo',
    autoStartCommand: 'acli rovodev run',
    icon: 'atlassian.png',
    terminalOnly: true,
  },
  {
    id: 'cline',
    name: 'Cline',
    docUrl: 'https://docs.cline.bot/cline-cli/overview',
    installCommand: 'npm install -g cline',
    commands: ['cline'],
    versionArgs: ['help'],
    cli: 'cline',
    initialPromptFlag: '',
    icon: 'cline.png',
    terminalOnly: true,
  },
  {
    id: 'continue',
    name: 'Continue',
    docUrl: 'https://docs.continue.dev/guides/cli',
    installCommand: 'npm i -g @continuedev/cli',
    commands: ['cn'],
    versionArgs: ['--version'],
    cli: 'cn',
    initialPromptFlag: '-p',
    resumeFlag: '--resume',
    icon: 'continue.png',
    terminalOnly: true,
  },
  {
    id: 'codebuff',
    name: 'Codebuff',
    docUrl: 'https://www.codebuff.com/docs/help/getting-started',
    installCommand: 'npm install -g codebuff',
    commands: ['codebuff'],
    versionArgs: ['--version'],
    cli: 'codebuff',
    initialPromptFlag: '',
    icon: 'codebuff.png',
    terminalOnly: true,
  },
  {
    id: 'mistral',
    name: 'Mistral Vibe',
    docUrl: 'https://github.com/mistralai/mistral-vibe',
    installCommand: 'curl -LsSf https://mistral.ai/vibe/install.sh | bash',
    commands: ['vibe'],
    versionArgs: ['-h'],
    cli: 'vibe',
    autoApproveFlag: '--auto-approve',
    initialPromptFlag: '--prompt',
    icon: 'mistral.png',
    terminalOnly: true,
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
