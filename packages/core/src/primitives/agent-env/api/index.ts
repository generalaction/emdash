export const AGENT_ENV_VARS = [
  'AIMLAPI_API_KEY',
  'ALL_PROXY',
  'AMP_API_KEY',
  'AMP_TOOLBOX',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_SMALL_FAST_MODEL',
  'APPDATA',
  'AUTOHAND_API_KEY',
  'AUGMENT_SESSION_AUTH',
  'AWS_ACCESS_KEY_ID',
  'AWS_DEFAULT_REGION',
  'AWS_PROFILE',
  'AWS_REGION',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AZURE_OPENAI_API_ENDPOINT',
  'AZURE_OPENAI_API_KEY',
  'AZURE_OPENAI_KEY',
  'BAILIAN_CODING_PLAN_API_KEY',
  'CLAUDE_CODE_DISABLE_BACKGROUND_TASKS',
  'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS',
  'CLAUDE_CODE_SUBAGENT_MODEL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CONFIG_DIR',
  'CODEBUFF_API_KEY',
  'CODEX_HOME',
  'COPILOT_HOME',
  'COPILOT_CLI_TOKEN',
  'CURSOR_API_KEY',
  'DASHSCOPE_API_KEY',
  'FACTORY_API_KEY',
  'GEMINI_API_KEY',
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'GOOGLE_API_KEY',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_CLOUD_LOCATION',
  'GOOGLE_CLOUD_PROJECT',
  'GOOGLE_GENAI_API_VERSION',
  'GOOGLE_VERTEX_BASE_URL',
  'GOOSE_CONTEXT_LIMIT',
  'GOOSE_LEAD_MODEL',
  'GOOSE_LEAD_PROVIDER',
  'GOOSE_MODE',
  'GOOSE_MODEL',
  'GOOSE_PLANNER_MODEL',
  'GOOSE_PLANNER_PROVIDER',
  'GOOSE_PROVIDER',
  'GOOSE_PROVIDER__API_KEY',
  'GOOSE_PROVIDER__HOST',
  'GOOSE_PROVIDER__TYPE',
  'GROK_CODE_XAI_API_KEY',
  'GROK_DEPLOYMENT_KEY',
  'GROK_HOME',
  'GROK_POOL_IDLE_TIMEOUT_SECS',
  'GROK_PROXY_URL',
  'GROK_SANDBOX',
  'GROQ_API_KEY',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'KIMI_API_KEY',
  'KIMI_CODE_HOME',
  'KIRO_HOME',
  'MISTRAL_API_KEY',
  'MIMOCODE_HOME',
  'MOONSHOT_API_KEY',
  'NO_PROXY',
  'OMP_AUTH_BROKER_SNAPSHOT_CACHE',
  'OMP_AUTH_BROKER_SNAPSHOT_TTL_MS',
  'OMP_AUTH_BROKER_URL',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_MODEL',
  'OPENAI_ORGANIZATION',
  'OPENAI_PROJECT',
  'OPENCODE_MODEL',
  'OPENCODE_CONFIG_DIR',
  'OPENROUTER_API_KEY',
  'OPENROUTER_BASE_URL',
  'PI_CODING_AGENT_DIR',
  'PI_CONFIG_DIR',
  'PI_NO_TITLE',
  'PI_OFFLINE',
  'PI_PLAN_MODEL',
  'PI_SKIP_VERSION_CHECK',
  'PI_SLOW_MODEL',
  'PI_SMOL_MODEL',
  'PRIME_AGENT_CODING_AGENT_DIR',
  'PRIME_AGENT_CODING_AGENT_SESSION_DIR',
  'PRIME_AGENT_KERNEL_FORKSERVER',
  'PRIME_AGENT_KERNEL_PYTHON',
  'PRIME_AGENT_KERNEL_VENV',
  'PRIME_AGENT_MAX_CONCURRENT_KERNEL_BOOTS',
  'PRIME_AGENT_SESSION_DIR',
  'PRIME_AGENT_TELEMETRY',
  'PRIME_AGENT_TELEMETRY_ENDPOINT',
  'PRIME_AGENT_TRACES_API_KEY',
  'PRIME_AGENT_TRACES_BASE_URL',
  'PRIME_API_KEY',
  'PRIME_INFERENCE_BASE_URL',
  'PRIME_TEAM_ID',
  'QWEN_CODE_SUPPRESS_YOLO_WARNING',
  'QWEN_DEFAULT_AUTH_TYPE',
  'QWEN_HOME',
  'QWEN_MODEL',
  'QWEN_RUNTIME_DIR',
  'QWEN_SANDBOX',
  'RLM_MAX_DEPTH',
  'VIBE_HOME',
  'XAI_API_KEY',
  'XDG_CACHE_HOME',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_STATE_HOME',
  'ZAI_API_KEY',
] as const;

const WINDOWS_AGENT_ENV_VARS = [
  'TEMP',
  'TMP',
  'SystemRoot',
  'windir',
  'ComSpec',
  'PATHEXT',
  'LOCALAPPDATA',
  'USERPROFILE',
] as const;

const DISPLAY_ENV_VARS = [
  'DISPLAY',
  'XAUTHORITY',
  'WAYLAND_DISPLAY',
  'XDG_RUNTIME_DIR',
  'XDG_CURRENT_DESKTOP',
  'XDG_SESSION_TYPE',
  'DBUS_SESSION_BUS_ADDRESS',
] as const;

const GLOBAL_AGENT_ENV_VARS = ['EDITOR', 'VISUAL', 'GIT_EDITOR', 'HOSTNAME', 'LANG', 'TZ'] as const;

const CANONICAL_WINDOWS_ENV_NAMES = new Map(
  [
    'TERM',
    'COLORTERM',
    'TERM_PROGRAM',
    'HOME',
    'USER',
    'PATH',
    ...GLOBAL_AGENT_ENV_VARS,
    ...DISPLAY_ENV_VARS,
    ...AGENT_ENV_VARS,
    ...WINDOWS_AGENT_ENV_VARS,
    'TMPDIR',
    'SSH_AUTH_SOCK',
    'SHELL',
  ].map((key) => [key.toLowerCase(), key] as const)
);

export interface BuildAllowlistedAgentEnvOptions {
  homeDir?: string;
  username?: string;
  includeShellVar?: boolean;
  platform?: AgentEnvPlatform;
}

export type AgentEnvPlatform = 'posix' | 'windows';

type EnvRecord = Readonly<Record<string, string | undefined>>;

export function buildAllowlistedAgentEnv(
  sourceEnv: EnvRecord,
  options: BuildAllowlistedAgentEnvOptions = {}
): Record<string, string> {
  const platform = options.platform ?? currentAgentEnvPlatform();
  const getValue = (key: string): string | undefined =>
    platform === 'windows' ? getWindowsEnvValue(sourceEnv, key) : sourceEnv[key];
  const env: Record<string, string> = {
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    TERM_PROGRAM: 'emdash',
    HOME: getValue('HOME') ?? getValue('USERPROFILE') ?? options.homeDir ?? '',
    USER: getValue('USER') ?? getValue('USERNAME') ?? options.username ?? '',
    PATH: getValue('PATH') ?? '',
    ...getAllowlistedEnv(sourceEnv, GLOBAL_AGENT_ENV_VARS, platform),
    ...getAllowlistedEnv(sourceEnv, DISPLAY_ENV_VARS, platform),
    ...getAllowlistedEnv(sourceEnv, AGENT_ENV_VARS, platform),
  };

  if (platform === 'windows') {
    Object.assign(env, getAllowlistedEnv(sourceEnv, WINDOWS_AGENT_ENV_VARS, platform));
  }

  const tmpDir = getValue('TMPDIR');
  const sshAuthSock = getValue('SSH_AUTH_SOCK');
  const shell = getValue('SHELL');
  if (tmpDir) env.TMPDIR = tmpDir;
  if (sshAuthSock) env.SSH_AUTH_SOCK = sshAuthSock;
  if (options.includeShellVar && shell) env.SHELL = shell;

  return env;
}

export function currentAgentEnvPlatform(
  platform: NodeJS.Platform = process.platform
): AgentEnvPlatform {
  return platform === 'win32' ? 'windows' : 'posix';
}

/**
 * Resolve a Windows environment key deterministically. An exact canonical spelling wins; otherwise
 * the last defined case-insensitive spelling wins. Plain objects can contain duplicate casings after
 * crossing Wire even though the native Windows environment cannot.
 */
export function getWindowsEnvKey(env: EnvRecord, key: string): string | undefined {
  if (env[key] !== undefined) return key;

  const lowerKey = key.toLowerCase();
  let match: string | undefined;
  for (const [candidate, value] of Object.entries(env)) {
    if (value !== undefined && candidate.toLowerCase() === lowerKey) match = candidate;
  }
  return match;
}

export function getWindowsEnvValue(env: EnvRecord, key: string): string | undefined {
  const envKey = getWindowsEnvKey(env, key);
  return envKey ? env[envKey] : undefined;
}

/**
 * Compose environment layers with Windows' case-insensitive key semantics. Later layers win. Known
 * agent keys use their canonical spelling; unknown provider-specific keys retain their first spelling.
 */
export function mergeWindowsEnvLayers(...layers: readonly EnvRecord[]): Record<string, string> {
  const merged: Record<string, string> = {};
  const keysByLowerCase = new Map<string, string>();

  for (const layer of layers) {
    for (const [key, value] of Object.entries(layer)) {
      if (value === undefined) continue;
      const lowerKey = key.toLowerCase();
      const outputKey =
        CANONICAL_WINDOWS_ENV_NAMES.get(lowerKey) ?? keysByLowerCase.get(lowerKey) ?? key;
      keysByLowerCase.set(lowerKey, outputKey);
      merged[outputKey] = value;
    }
  }

  return merged;
}

export function mergeAgentEnvLayers(
  platform: AgentEnvPlatform,
  ...layers: readonly EnvRecord[]
): Record<string, string> {
  if (platform === 'windows') return mergeWindowsEnvLayers(...layers);
  const merged: Record<string, string> = {};
  for (const layer of layers) {
    for (const [key, value] of Object.entries(layer)) {
      if (value !== undefined) merged[key] = value;
    }
  }
  return merged;
}

function getAllowlistedEnv(
  sourceEnv: EnvRecord,
  keys: readonly string[],
  platform: AgentEnvPlatform
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of keys) {
    const value = platform === 'windows' ? getWindowsEnvValue(sourceEnv, key) : sourceEnv[key];
    if (value) env[key] = value;
  }
  return env;
}
