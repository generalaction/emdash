import { access } from 'node:fs/promises';
import os from 'node:os';
import { delimiter, dirname, isAbsolute, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acpApiContract, acpHostContract, type AcpApiContract } from '@emdash/core/acp';
import { pluginRegistry } from '@emdash/plugins/agents';
import { createController, serve, type ContractClient } from '@emdash/wire/api';
import { processTransport, type ManagedProcess } from '@emdash/wire/process';
import { childProcessHost } from '@emdash/wire/process/node';
import { spawnRuntime } from '@emdash/wire/util/process-runtime';
import { daemonPaths } from '../daemon/paths';

const AGENT_ENV_VARS = [
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
  'COPILOT_CLI_TOKEN',
  'CURSOR_API_KEY',
  'DASHSCOPE_API_KEY',
  'FACTORY_API_KEY',
  'GEMINI_API_KEY',
  'GEMINI_MODEL',
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'GOOGLE_API_KEY',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_CLOUD_LOCATION',
  'GOOGLE_CLOUD_PROJECT',
  'GOOGLE_GEMINI_BASE_URL',
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
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'KIMI_API_KEY',
  'MISTRAL_API_KEY',
  'MOONSHOT_API_KEY',
  'NO_PROXY',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_MODEL',
  'OPENAI_ORGANIZATION',
  'OPENAI_PROJECT',
  'OPENCODE_MODEL',
  'OPENROUTER_API_KEY',
  'OPENROUTER_BASE_URL',
  'QWEN_CODE_SUPPRESS_YOLO_WARNING',
  'QWEN_DEFAULT_AUTH_TYPE',
  'QWEN_HOME',
  'QWEN_MODEL',
  'QWEN_RUNTIME_DIR',
  'QWEN_SANDBOX',
  'XAI_API_KEY',
] as const;

const GLOBAL_AGENT_ENV_VARS = [
  'COLORTERM',
  'EDITOR',
  'GIT_EDITOR',
  'HOSTNAME',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'LC_MESSAGES',
  'SHELL',
  'SSH_AUTH_SOCK',
  'TERM',
  'TZ',
  'VISUAL',
] as const;

export type WorkspaceAcpRuntimeClient = ContractClient<AcpApiContract>;

export async function spawnAcpWorkspaceRuntimeProcess(options: { socketPath?: string }): Promise<{
  client: WorkspaceAcpRuntimeClient;
  dispose(): Promise<void>;
}> {
  const paths = daemonPaths(options.socketPath);
  const entry = await resolveRuntimeEntry();
  log('info', 'ACP runtime child process entry resolved', { entry });
  const handle = await spawnRuntime({
    host: childProcessHost(),
    contract: acpApiContract,
    spec: {
      entry,
      env: {
        ...process.env,
        EMDASH_ACP_ATTACHMENTS_DIR: join(dirname(paths.socketPath), 'acp-attachments'),
      },
      supervision: { restart: 'on-failure', backoffMs: [250, 1_000, 2_500], maxRestarts: 5 },
    },
    onProcess: attachAcpRuntimeLogging,
  });

  const transport = processTransport(handle.process);
  const controller = createController(
    acpHostContract,
    {
      resolveSpawnContext: ({ providerId }) => resolveWorkspaceAcpSpawnContext(providerId),
      persistSessionId: ({ conversationId, sessionId }) => {
        log('debug', 'ACP runtime returned session id for client persistence', {
          conversationId,
          sessionId,
        });
      },
      log: ({ level, message, data }) => {
        log(level, message, data);
      },
    },
    { validate: 'full' }
  );
  const disposeServer = serve(transport, controller);
  handle.onRestarted(() => {
    log('info', 'ACP runtime child process restarted');
  });

  return {
    client: handle.client,
    async dispose() {
      disposeServer();
      transport.close?.();
      await handle.dispose();
    },
  };
}

export async function resolveWorkspaceAcpSpawnContext(
  providerId: string,
  options: {
    env?: NodeJS.ProcessEnv;
    resolveExecutable?: (binaryName: string) => Promise<string>;
  } = {}
): Promise<{ cli: string; agentEnv: Record<string, string> }> {
  const plugin = pluginRegistry.get(providerId);
  const binaryName = plugin?.capabilities.hostDependency.binaryNames[0] ?? providerId;
  const cli = await (options.resolveExecutable ?? resolveExecutable)(binaryName);
  return { cli, agentEnv: buildWorkspaceAcpAgentEnv(options.env) };
}

async function resolveExecutable(binaryName: string): Promise<string> {
  if (isPathLike(binaryName)) {
    return (await canExecute(binaryName)) ? binaryName : binaryName;
  }

  for (const dir of getPathDirs()) {
    for (const candidate of executableCandidates(join(dir, binaryName))) {
      if (await canExecute(candidate)) return candidate;
    }
  }

  log('warn', `Could not resolve agent binary "${binaryName}" on PATH; using bare command`);
  return binaryName;
}

export function buildWorkspaceAcpAgentEnv(
  sourceEnv: NodeJS.ProcessEnv = process.env
): Record<string, string> {
  const env: Record<string, string> = {
    TERM: sourceEnv.TERM || 'xterm-256color',
    COLORTERM: sourceEnv.COLORTERM || 'truecolor',
    TERM_PROGRAM: 'emdash',
    HOME: sourceEnv.HOME || os.homedir(),
    USER: sourceEnv.USER || os.userInfo().username,
    PATH: sourceEnv.PATH ?? '',
  };

  copyEnv(env, sourceEnv, GLOBAL_AGENT_ENV_VARS);
  copyEnv(env, sourceEnv, AGENT_ENV_VARS);
  return env;
}

function copyEnv(
  target: Record<string, string>,
  source: NodeJS.ProcessEnv,
  keys: readonly string[]
): void {
  for (const key of keys) {
    const value = source[key];
    if (value) target[key] = value;
  }
}

async function resolveRuntimeEntry(): Promise<string> {
  const baseDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(baseDir, 'acp-runtime.mjs'),
    join(baseDir, 'acp-runtime.js'),
    join(baseDir, 'runtime-entry.ts'),
  ];
  for (const candidate of candidates) {
    if (await canRead(candidate)) return candidate;
  }
  throw new Error(`ACP runtime child process entry is missing. Checked: ${candidates.join(', ')}`);
}

function attachAcpRuntimeLogging(process: ManagedProcess): void {
  process.onStdio((stream, chunk) => {
    log(stream === 'stderr' ? 'warn' : 'debug', `ACP runtime ${stream}`, { chunk });
  });
  process.onExit((exit) => {
    log('warn', 'ACP runtime child process exited', exit);
  });
}

function getPathDirs(): string[] {
  const rawPath = process.env.PATH ?? '';
  return rawPath.split(delimiter).filter(Boolean);
}

function executableCandidates(path: string): string[] {
  if (process.platform !== 'win32') return [path];
  const ext = process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD';
  const lower = path.toLowerCase();
  if (ext.split(';').some((suffix) => lower.endsWith(suffix.toLowerCase()))) return [path];
  return ext.split(';').map((suffix) => `${path}${suffix.toLowerCase()}`);
}

function isPathLike(value: string): boolean {
  return isAbsolute(value) || value.includes('/') || value.includes('\\') || value.includes(sep);
}

async function canExecute(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function canRead(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function log(level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: unknown): void {
  const serialized = data === undefined ? '' : ` ${JSON.stringify(data)}`;
  process.stderr.write(`[acp-runtime:${level}] ${message}${serialized}\n`);
}
