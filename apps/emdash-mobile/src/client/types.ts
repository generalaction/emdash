import type { TranscriptTurn } from '@emdash/chat-ui';
import type { PromptInput } from '@emdash/core/acp';

export type ConnectionStatus = 'connecting' | 'online' | 'reconnecting' | 'offline';

export type TaskStatus = 'ready' | 'dormant' | 'provisioning' | 'unavailable';

export type ResourceCategory = 'conversations' | 'terminals' | 'files' | 'changes' | 'browser';

export type ResourceKind = 'acp' | 'agent-terminal' | 'terminal' | 'file' | 'diff' | 'browser';

export interface ProjectSummary {
  id: string;
  name: string;
  repository?: string;
}

export interface TaskSummary {
  id: string;
  projectId: string;
  name: string;
  branch?: string;
  status: TaskStatus;
  statusMessage?: string;
  counts: Partial<Record<ResourceCategory, number>>;
}

export interface Catalog {
  projects: ProjectSummary[];
  tasks: TaskSummary[];
}

export interface BootstrapState {
  authenticated: boolean;
  deviceName?: string;
  catalog?: Catalog;
}

export interface ResourceSummary {
  id: string;
  taskId: string;
  kind: ResourceKind;
  title: string;
  subtitle?: string;
  status?: 'idle' | 'working' | 'attention' | 'exited' | 'changed';
  badge?: string;
  /** File-browser metadata; absent for non-file resources. */
  path?: string;
  directory?: boolean;
}

export interface ResourceHandleBase {
  handleId: string;
  summary: ResourceSummary;
}

export interface PromptQueueItem extends PromptInput {
  id: string;
}

export type AcpPromptInput = Omit<PromptQueueItem, 'id'>;

export interface AcpDraft extends PromptInput {
  revision: number;
}

export interface AcpTerminalOutput {
  terminalId: string;
  output: string;
}

export interface PermissionRequest {
  id: string;
  title: string;
  description?: string;
  options: Array<{ id: string; label: string; tone?: 'default' | 'danger' }>;
}

export interface AcpResourceHandle extends ResourceHandleBase {
  kind: 'acp';
  transcript: TranscriptTurn[];
  draft: AcpDraft;
  isWorking: boolean;
  model?: string;
  mode?: string;
  effort?: string;
  availableModels: Array<{ id: string; name: string }>;
  availableModes: Array<{ id: string; name: string }>;
  availableEfforts: Array<{ id: string; name: string }>;
  queue: PromptQueueItem[];
  terminalOutputs: AcpTerminalOutput[];
  permission?: PermissionRequest;
}

export interface PtyResourceHandle extends ResourceHandleBase {
  kind: 'agent-terminal' | 'terminal';
  snapshot: string;
  cols: number;
  rows: number;
  exited: boolean;
  exitCode?: number;
}

export interface FileResourceHandle extends ResourceHandleBase {
  kind: 'file';
  path: string;
  content?: string;
  imageUrl?: string;
  language?: string;
  binary: boolean;
  truncated: boolean;
  size: number;
}

export interface DiffLine {
  kind: 'context' | 'addition' | 'deletion' | 'header';
  oldNumber?: number;
  newNumber?: number;
  text: string;
}

export interface DiffResourceHandle extends ResourceHandleBase {
  kind: 'diff';
  path: string;
  staged: boolean;
  additions: number;
  deletions: number;
  lines: DiffLine[];
  truncated: boolean;
}

export interface BrowserResourceHandle extends ResourceHandleBase {
  kind: 'browser';
  url: string;
  openable: boolean;
  warning?: string;
}

export type ResourceHandle =
  | AcpResourceHandle
  | PtyResourceHandle
  | FileResourceHandle
  | DiffResourceHandle
  | BrowserResourceHandle;

export interface CreateAgentOption {
  id: string;
  name: string;
  installed: boolean;
  interfaces: Array<'acp' | 'terminal'>;
  models: Array<{ id: string; name: string }>;
  supportsAutoApprove: boolean;
}

export interface CreateOptions {
  agents: CreateAgentOption[];
  defaultAgentId?: string;
  shells: Array<{ id: string; name: string }>;
  defaultShellId?: string;
  autoApproveByDefault: boolean;
}

export type CreateResourceRequest =
  | {
      requestId: string;
      taskId: string;
      kind: 'acp' | 'agent-terminal';
      agentId?: string;
      modelId?: string;
      autoApprove?: boolean;
    }
  | {
      requestId: string;
      taskId: string;
      kind: 'terminal';
      shellId?: string;
    };

export interface PromptAttachment {
  id: string;
  name: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
  bytes: Uint8Array;
}

export type MobileEvent =
  | { type: 'catalog.changed'; catalog: Catalog }
  | { type: 'resource.changed'; handle: ResourceHandle }
  | { type: 'resource.renamed'; resourceId: string; title: string }
  | { type: 'pty.data'; handleId: string; data: string }
  | { type: 'pty.exit'; handleId: string; exitCode?: number }
  | { type: 'acp.transcript'; handleId: string; transcript: TranscriptTurn[] }
  | { type: 'acp.working'; handleId: string; isWorking: boolean }
  | {
      type: 'acp.draft';
      handleId: string;
      draft: AcpDraft;
    };

export interface DraftUpdateResult {
  accepted: boolean;
  current: AcpDraft;
}

export interface TranscriptExport {
  name: string;
  mimeType: string;
  content: string;
}

export type MobileEventListener = (event: MobileEvent) => void;
export type ConnectionListener = (status: ConnectionStatus) => void;

/**
 * UI-facing boundary for Mobile Access. The production gateway adapter and the
 * in-memory demo adapter both implement this interface. All resource operations
 * after open use connection-scoped opaque handles.
 */
export interface MobileClient {
  readonly connectionStatus: ConnectionStatus;
  bootstrap(): Promise<BootstrapState>;
  pair(code: string): Promise<BootstrapState>;
  logout(): Promise<void>;
  getResources(
    taskId: string,
    category: ResourceCategory,
    path?: string
  ): Promise<ResourceSummary[]>;
  openResource(resourceId: string): Promise<ResourceHandle>;
  closeResource(handleId: string): Promise<void>;
  getCreateOptions(taskId: string): Promise<CreateOptions>;
  createResource(request: CreateResourceRequest): Promise<ResourceSummary>;
  renameResource(resourceId: string, title: string): Promise<ResourceSummary>;
  sendPrompt(
    handleId: string,
    input: AcpPromptInput,
    attachments: PromptAttachment[]
  ): Promise<void>;
  queuePrompt(
    handleId: string,
    input: AcpPromptInput,
    attachments: PromptAttachment[]
  ): Promise<void>;
  editQueuedPrompt(handleId: string, promptId: string, input: AcpPromptInput): Promise<void>;
  deleteQueuedPrompt(handleId: string, promptId: string): Promise<void>;
  reorderQueuedPrompts(handleId: string, promptIds: string[]): Promise<void>;
  exportTranscript(handleId: string, format: 'parsed' | 'raw'): Promise<TranscriptExport>;
  cancelPrompt(handleId: string): Promise<void>;
  respondToPermission(handleId: string, requestId: string, optionId: string): Promise<void>;
  updateAcpOption(
    handleId: string,
    option: 'model' | 'mode' | 'effort',
    value: string
  ): Promise<void>;
  updateDraft(
    handleId: string,
    expectedRevision: number,
    input: AcpPromptInput
  ): Promise<DraftUpdateResult>;
  sendPtyInput(handleId: string, data: string): Promise<void>;
  resizePty(handleId: string, cols: number, rows: number): Promise<void>;
  subscribe(listener: MobileEventListener): () => void;
  subscribeConnection(listener: ConnectionListener): () => void;
  reconnect(): void;
  dispose(): void;
}
