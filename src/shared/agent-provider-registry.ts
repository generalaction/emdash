export const AGENT_PROVIDER_IDS = [
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
  'pi',
  'autohand',
] as const;

export type AgentProviderId = (typeof AGENT_PROVIDER_IDS)[number];

export type AgentProviderDefinition = {
  id: AgentProviderId;
  name: string;
  docUrl?: string;
  installCommand?: string;
  commands?: string[];
  versionArgs?: string[];
  detectable?: boolean;
  cli?: string;
  autoApproveFlag?: string;
  initialPromptFlag?: string;
  /**
   * When true, the initial prompt is delivered via keystroke injection
   * (typing into the TUI after startup) instead of as a CLI argument.
   * Use for agents whose CLI has no flag for interactive-mode prompt delivery.
   */
  useKeystrokeInjection?: boolean;
  resumeFlag?: string;
  /**
   * CLI flag to assign a unique session ID per chat instance.
   * Used to isolate session state when multiple chats of the same provider
   * run in the same worktree. The flag receives a deterministic UUID
   * derived from the Emdash conversation ID.
   * e.g. '--session-id' for Claude Code.
   */
  sessionIdFlag?: string;
  defaultArgs?: string[];
  planActivateCommand?: string;
  autoStartCommand?: string;
  icon?: string;
  /** Accessible alt text for the provider logo. */
  alt?: string;
  /** When true, the logo should be colour-inverted in dark mode. */
  invertInDark?: boolean;
  terminalOnly?: boolean;
  supportsHooks?: boolean;
};

export const AGENT_PROVIDERS: AgentProviderDefinition[] = [
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
    resumeFlag: 'resume --last',
    icon: 'openai.svg',
    alt: 'Codex',
    terminalOnly: true,
    supportsHooks: true,
  },
  {
    id: 'claude',
    name: 'Claude Code',
    docUrl: 'https://docs.anthropic.com/claude/docs/claude-code',
    installCommand: 'curl -fsSL https://claude.ai/install.sh | bash',
    commands: ['claude'],
    versionArgs: ['--version'],
    cli: 'claude',
    autoApproveFlag: '--dangerously-skip-permissions',
    initialPromptFlag: '',
    resumeFlag: '--resume',
    sessionIdFlag: '--session-id',
    planActivateCommand: '/plan',
    icon: 'claude.png',
    alt: 'Claude Code',
    terminalOnly: true,
    supportsHooks: true,
  },
  {
    id: 'cursor',
    name: 'Cursor',
    docUrl: 'https://cursor.sh',
    installCommand: 'curl https://cursor.com/install -fsS | bash',
    commands: ['cursor-agent'],
    versionArgs: ['--version'],
    cli: 'cursor-agent',
    autoApproveFlag: '-f',
    initialPromptFlag: '',
    icon: 'cursor.svg',
    alt: 'Cursor CLI',
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
    autoApproveFlag: '--yolo',
    initialPromptFlag: '-i',
    resumeFlag: '--resume',
    icon: 'gemini.png',
    alt: 'Gemini CLI',
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
    alt: 'Qwen Code CLI',
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
    resumeFlag: '-r',
    icon: 'droid.svg',
    alt: 'Factory Droid',
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
    autoApproveFlag: '--dangerously-allow-all',
    initialPromptFlag: '',
    useKeystrokeInjection: true,
    icon: 'ampcode.png',
    alt: 'Amp CLI',
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
    initialPromptFlag: '',
    useKeystrokeInjection: true,
    icon: 'opencode.png',
    alt: 'OpenCode CLI',
    invertInDark: true,
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
    autoApproveFlag: '--allow-all-tools',
    icon: 'gh-copilot.svg',
    alt: 'GitHub Copilot CLI',
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
    autoApproveFlag: '--yolo',
    icon: 'charm.png',
    alt: 'Charm CLI',
    invertInDark: true,
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
    icon: 'Auggie.svg',
    alt: 'Auggie CLI',
    terminalOnly: true,
  },
  {
    id: 'goose',
    name: 'Goose',
    docUrl: 'https://block.github.io/goose/docs/quickstart/',
    installCommand:
      'curl -fsSL https://github.com/block/goose/releases/download/stable/download_cli.sh | bash',
    commands: ['goose'],
    versionArgs: ['--version'],
    cli: 'goose',
    // run subcommand with -s for interactive mode after initial prompt
    defaultArgs: ['run', '-s'],
    initialPromptFlag: '-t',
    icon: 'goose.png',
    alt: 'Goose CLI',
    terminalOnly: true,
  },
  {
    id: 'kimi',
    name: 'Kimi',
    docUrl: 'https://www.kimi.com/code/docs/en/kimi-cli/guides/getting-started.html',
    installCommand: 'uv tool install kimi-cli',
    commands: ['kimi'],
    versionArgs: ['--version'],
    cli: 'kimi',
    autoApproveFlag: '--yolo',
    initialPromptFlag: '-c',
    icon: 'kimi.png',
    alt: 'Kimi CLI',
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
    alt: 'Kilocode CLI',
    terminalOnly: true,
  },
  {
    id: 'kiro',
    name: 'Kiro (AWS)',
    docUrl: 'https://kiro.dev/docs/cli/',
    installCommand: 'curl -fsSL https://cli.kiro.dev/install | bash',
    commands: ['kiro-cli'],
    versionArgs: ['--version'],
    cli: 'kiro-cli',
    defaultArgs: ['chat'],
    initialPromptFlag: '',
    icon: 'kiro.png',
    alt: 'Kiro CLI',
    terminalOnly: true,
  },
  {
    id: 'rovo',
    name: 'Rovo Dev',
    docUrl: 'https://support.atlassian.com/rovo/docs/install-and-run-rovo-dev-cli-on-your-device/',
    installCommand: 'acli rovodev auth login',
    commands: ['rovodev', 'acli'],
    versionArgs: ['--version'],
    autoApproveFlag: '--yolo',
    autoStartCommand: 'acli rovodev run',
    icon: 'atlassian.png',
    alt: 'Rovo Dev CLI',
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
    autoApproveFlag: '--yolo',
    initialPromptFlag: '',
    icon: 'cline.png',
    alt: 'Cline CLI',
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
    alt: 'Continue CLI',
    terminalOnly: true,
  },
  {
    id: 'codebuff',
    name: 'Codebuff',
    docUrl: 'https://www.codebuff.com/docs/help/quick-start',
    installCommand: 'npm install -g codebuff',
    commands: ['codebuff'],
    versionArgs: ['--version'],
    cli: 'codebuff',
    initialPromptFlag: '',
    icon: 'codebuff.png',
    alt: 'Codebuff CLI',
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
    alt: 'Mistral Vibe CLI',
    terminalOnly: true,
  },
  {
    id: 'pi',
    name: 'Pi',
    docUrl: 'https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent',
    installCommand: 'npm install -g @mariozechner/pi-coding-agent',
    commands: ['pi'],
    versionArgs: ['--version'],
    cli: 'pi',
    initialPromptFlag: '',
    resumeFlag: '-c',
    icon: 'pi.png',
    alt: 'Pi CLI',
    terminalOnly: true,
  },
  {
    id: 'autohand',
    name: 'Autohand Code',
    docUrl: 'https://autohand.ai/code/',
    installCommand: 'npm install -g autohand-cli',
    commands: ['autohand'],
    versionArgs: ['--version'],
    cli: 'autohand',
    autoApproveFlag: '--unrestricted',
    initialPromptFlag: '-p',
    icon: 'autohand.svg',
    alt: 'Autohand Code CLI',
    terminalOnly: true,
  },
];

const PROVIDER_MAP = new Map<string, AgentProviderDefinition>(
  AGENT_PROVIDERS.map((provider) => [provider.id, provider])
);

export function getProvider(id: AgentProviderId): AgentProviderDefinition | undefined {
  return PROVIDER_MAP.get(id);
}

export function getInstallCommandForProvider(id: AgentProviderId): string | null {
  return PROVIDER_MAP.get(id)?.installCommand ?? null;
}

/**
 * Validates if a string is a valid provider ID.
 * @param value - The value to validate
 * @returns true if the value is a valid provider ID, false otherwise
 */
export function isValidProviderId(value: unknown): value is AgentProviderId {
  return typeof value === 'string' && AGENT_PROVIDER_IDS.includes(value as AgentProviderId);
}

export function getDocUrlForProvider(id: AgentProviderId): string | null {
  return PROVIDER_MAP.get(id)?.docUrl ?? null;
}

export function listDetectableProviders(): AgentProviderDefinition[] {
  return AGENT_PROVIDERS.filter(
    (provider) => provider.detectable !== false && provider.commands?.length
  );
}
