import type { GitCredentialsSessionSpec } from '@emdash/core/primitives/git-credentials/api';
import type { HostRef } from '@emdash/core/primitives/host/api';
import type { TuiAgentStartInput } from '@emdash/core/runtimes/tui-agents/api';
import { makeTmuxSessionName } from '@emdash/core/services/pty/api';
import { and, eq } from 'drizzle-orm';
import { conversationRegistryTable as conversations } from '@core/features/conversations/api/node/registry';
import type {
  ConversationProvider,
  EnsureConversationSessionRequest,
  EnsureConversationSessionResult,
} from '@core/features/conversations/api/node/types';
import type { TaskSessionLaunchContextSource } from '@core/features/tasks/api/node/task-session-launch-context';
import type { ProviderCustomConfig } from '@core/primitives/app-settings/api';
import type { Conversation } from '@core/primitives/conversations/api';
import { makePtySessionId } from '@core/primitives/pty/api';
import type { AppDb } from '@core/services/app-db/node/db';
import type { TuiAgentsRuntimeClient } from '@core/services/runtime-broker/api/clients';

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const PROVIDER_SESSION_ID_REQUIRED_FOR_RESUME = new Set([
  'amp',
  'codex',
  'commandcode',
  'droid',
  'goose',
  'oh-my-pi',
  'pi',
  'prime-agent',
]);

export type TuiConversationProviderOptions = {
  host: HostRef;
  tuiAgents: TuiAgentsRuntimeClient;
  projectId: string;
  taskId: string;
  taskPath: string;
  launchContextSource: TaskSessionLaunchContextSource;
};

export type TuiConversationProviderDependencies = {
  db: AppDb;
  getProviderConfig(providerId: string): Promise<ProviderCustomConfig | undefined>;
  getTaskSettings(): Promise<{ autoTrustWorktrees: boolean }>;
  getTerminalColorEnv(): Promise<Record<string, string>>;
  /**
   * Per-session git credential behavior from the project's "agent git
   * credentials" setting (spec: github-git-settings §4); constructed into the
   * session env by the tui-agents runtime through the blessed builder.
   */
  resolveSessionGitCredentials(params: {
    projectId: string;
    host: HostRef;
  }): Promise<GitCredentialsSessionSpec | undefined>;
};

function parseExtraArgs(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  return value.trim().split(/\s+/);
}

export class TuiConversationProvider implements ConversationProvider {
  private readonly projectId: string;
  private readonly taskId: string;
  private readonly taskPath: string;
  private readonly host: HostRef;
  private readonly tuiAgents: TuiAgentsRuntimeClient;
  private readonly launchContextSource: TaskSessionLaunchContextSource;

  constructor(
    options: TuiConversationProviderOptions,
    private readonly dependencies: TuiConversationProviderDependencies
  ) {
    this.projectId = options.projectId;
    this.taskId = options.taskId;
    this.taskPath = options.taskPath;
    this.host = options.host;
    this.tuiAgents = options.tuiAgents;
    this.launchContextSource = options.launchContextSource;
  }

  async ensureSession({
    conversation,
    mode,
    initialSize = { cols: DEFAULT_COLS, rows: DEFAULT_ROWS },
    initialPrompt,
  }: EnsureConversationSessionRequest): Promise<EnsureConversationSessionResult> {
    const input = await this.buildStartInput(conversation, initialSize, mode, initialPrompt);
    const agentSession = resolveAgentSession(conversation, mode);
    const result = agentSession.isResuming
      ? await this.tuiAgents.resume(input)
      : await this.tuiAgents.start(input);
    if (!result.success) {
      throw new Error(`TUI session failed to start: ${JSON.stringify(result.error)}`);
    }
    return { outcome: result.data.outcome };
  }

  async detachSession(_conversationId: string): Promise<void> {
    // Output subscriptions are passive; explicit control and workspace teardown own PTY lifetime.
  }

  async stopSession(conversationId: string): Promise<void> {
    await this.tuiAgents.stop({ conversationId });
  }

  async deleteSession(conversationId: string): Promise<void> {
    await this.tuiAgents.delete({ conversationId });
  }

  async destroyAll(): Promise<void> {
    const rows = await this.dependencies.db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.taskId, this.taskId), eq(conversations.type, 'pty')));
    await Promise.all(rows.map((row) => this.stopSession(row.id)));
  }

  async detachAll(): Promise<void> {
    // Runtime leases are held by renderer output bindings; no provider-owned PTY to detach.
  }

  private async buildStartInput(
    conversation: Conversation,
    initialSize: { cols: number; rows: number },
    mode: 'start' | 'resume',
    initialPrompt: string | undefined
  ): Promise<TuiAgentStartInput> {
    const agentSession = resolveAgentSession(conversation, mode);
    const effectiveInitialPrompt =
      !agentSession.isResuming && mode === 'start' ? initialPrompt : undefined;
    const [providerConfig, taskSettings, colorEnv, launchContext, gitCredentials] =
      await Promise.all([
        this.dependencies.getProviderConfig(conversation.providerId),
        conversation.autoApprove === true
          ? Promise.resolve(undefined)
          : this.dependencies.getTaskSettings(),
        this.dependencies.getTerminalColorEnv(),
        this.launchContextSource.resolve(),
        this.dependencies.resolveSessionGitCredentials({
          projectId: this.projectId,
          host: this.host,
        }),
      ]);
    if (!launchContext.success) {
      throw new Error(`Could not resolve task session launch context: ${launchContext.error.type}`);
    }
    const trustWorkspace =
      conversation.autoApprove === true || taskSettings?.autoTrustWorktrees === true;
    const providerVars = {
      ...(providerConfig?.env ?? {}),
      ...colorEnv,
      ...launchContext.data.env,
    };
    const sessionId = makePtySessionId(this.projectId, this.taskId, conversation.id);

    return {
      conversationId: conversation.id,
      providerId: conversation.providerId,
      cwd: this.taskPath,
      sessionId: agentSession.isResuming ? agentSession.sessionId : null,
      // Fresh spawns declare the emdash-chosen resume handle (resolveAgentSession falls
      // back to the conversation id), so the index learns it at spawn (spec §3.1).
      chosenSessionId: agentSession.isResuming ? null : agentSession.sessionId,
      model: conversation.model ?? null,
      initialPrompt: effectiveInitialPrompt,
      autoApprove: conversation.autoApprove ?? false,
      trustWorkspace,
      extraArgs: parseExtraArgs(providerConfig?.extraArgs),
      providerVars,
      gitCredentials,
      cols: initialSize.cols,
      rows: initialSize.rows,
      shellSetup: launchContext.data.shellSetup,
      tmuxSessionName: launchContext.data.tmux ? makeTmuxSessionName(sessionId) : undefined,
    };
  }
}

function resolveAgentSession(
  conversation: Conversation,
  mode: 'start' | 'resume'
): { sessionId: string; isResuming: boolean } {
  const isResuming = mode === 'resume';
  if (PROVIDER_SESSION_ID_REQUIRED_FOR_RESUME.has(conversation.providerId) && isResuming) {
    const nativeSessionId = conversation.sessionId;
    if (nativeSessionId && nativeSessionId !== conversation.id) {
      return { sessionId: nativeSessionId, isResuming: true };
    }
    return { sessionId: conversation.id, isResuming: false };
  }

  return { sessionId: conversation.id, isResuming };
}
