import { homedir } from 'node:os';
import type { TuiAgentStartInput } from '@emdash/core/runtimes/tui-agents/api';
import { makeTmuxSessionName } from '@emdash/core/services/pty/api';
import { and, eq } from 'drizzle-orm';
import type { Conversation } from '@core/primitives/conversations/api';
import { makePtySessionId } from '@core/primitives/pty/api';
import { conversations } from '@core/services/app-db/node/schema';
import {
  getAppSettingsService,
  getProviderOverrideSettings,
} from '@main/bootstrap/core/service-instances';
import { workspaceTrustService } from '@main/core/agents/workspace-trust';
import {
  spillLargePrompt,
  type SpillLargePromptResult,
} from '@main/core/conversations/spill-large-prompt';
import type {
  ConversationProvider,
  EnsureConversationSessionRequest,
  EnsureConversationSessionResult,
} from '@main/core/conversations/types';
import { getTerminalColorEnv } from '@main/core/terminal-shell/color-env';
import { getAppDb } from '@main/db/instance';
import { getTuiAgentsRuntimeClient } from '@main/gateway/accessors';

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
]);

type TuiConversationProviderOptions = {
  projectId: string;
  taskId: string;
  taskPath: string;
  tmux?: boolean;
  shellSetup?: string;
  taskEnvVars?: Record<string, string>;
};

function parseExtraArgs(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  return value.trim().split(/\s+/);
}

export class TuiConversationProvider implements ConversationProvider {
  private readonly projectId: string;
  private readonly taskId: string;
  private readonly taskPath: string;
  private readonly tmux: boolean;
  private readonly shellSetup?: string;
  private readonly taskEnvVars: Record<string, string>;
  private readonly spills = new Map<string, SpillLargePromptResult>();

  constructor(options: TuiConversationProviderOptions) {
    this.projectId = options.projectId;
    this.taskId = options.taskId;
    this.taskPath = options.taskPath;
    this.tmux = options.tmux ?? false;
    this.shellSetup = options.shellSetup;
    this.taskEnvVars = options.taskEnvVars ?? {};
  }

  async ensureSession({
    conversation,
    mode,
    initialSize = { cols: DEFAULT_COLS, rows: DEFAULT_ROWS },
    initialPrompt,
  }: EnsureConversationSessionRequest): Promise<EnsureConversationSessionResult> {
    const input = await this.buildStartInput(conversation, initialSize, mode, initialPrompt);
    const client = await getTuiAgentsRuntimeClient();
    const agentSession = resolveAgentSession(conversation, mode);
    const result = agentSession.isResuming
      ? await client.resumeSession({ input })
      : await client.startSession({ input });
    if (!result.success) {
      throw new Error(`TUI session failed to start: ${JSON.stringify(result.error)}`);
    }
    return { outcome: result.data.outcome };
  }

  async detachSession(_conversationId: string): Promise<void> {
    // Output subscriptions are passive; explicit control and idle cleanup own PTY lifetime.
  }

  async stopSession(conversationId: string): Promise<void> {
    const client = await getTuiAgentsRuntimeClient();
    await client.stopSession({ conversationId });
    await this.cleanupSpill(conversationId);
  }

  async deleteSession(conversationId: string): Promise<void> {
    const client = await getTuiAgentsRuntimeClient();
    await client.deleteSession({ conversationId });
    await this.cleanupSpill(conversationId);
  }

  async destroyAll(): Promise<void> {
    const rows = await getAppDb()
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
    await workspaceTrustService.maybeAutoTrust({
      providerId: conversation.providerId,
      workspacePath: this.taskPath,
      host: { kind: 'local', homedir: homedir() },
      force: conversation.autoApprove === true,
    });
    const providerConfig = await getProviderOverrideSettings().getItem(conversation.providerId);
    const localProjectSettings = await getAppSettingsService().get('localProject');
    const agentSession = resolveAgentSession(conversation, mode);
    const effectiveInitialPrompt = await this.effectiveInitialPrompt(
      conversation.id,
      !agentSession.isResuming && mode === 'start' ? initialPrompt : undefined
    );
    const colorEnv = await getTerminalColorEnv();
    const providerVars = {
      ...(providerConfig?.env ?? {}),
      ...colorEnv,
      ...this.taskEnvVars,
    };
    const sessionId = makePtySessionId(this.projectId, this.taskId, conversation.id);

    return {
      conversationId: conversation.id,
      providerId: conversation.providerId,
      cwd: this.taskPath,
      sessionId: agentSession.isResuming ? agentSession.sessionId : null,
      model: conversation.model ?? null,
      initialPrompt: effectiveInitialPrompt,
      autoApprove: conversation.autoApprove ?? false,
      extraArgs: parseExtraArgs(providerConfig?.extraArgs),
      providerVars,
      cols: initialSize.cols,
      rows: initialSize.rows,
      shellSetup: this.shellSetup,
      tmuxSessionName: this.tmux ? makeTmuxSessionName(sessionId) : undefined,
      hookInstall: {
        writeGitIgnoreEntries: localProjectSettings.writeAgentConfigToGitIgnore ?? true,
      },
    };
  }

  private async effectiveInitialPrompt(
    conversationId: string,
    initialPrompt: string | undefined
  ): Promise<string | undefined> {
    if (!initialPrompt) return undefined;
    await this.cleanupSpill(conversationId);
    const spill = await spillLargePrompt(initialPrompt);
    this.spills.set(conversationId, spill);
    return spill.prompt;
  }

  private async cleanupSpill(conversationId: string): Promise<void> {
    const spill = this.spills.get(conversationId);
    if (!spill) return;
    this.spills.delete(conversationId);
    await spill.cleanup();
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
