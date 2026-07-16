import type { TranscriptTurn } from '@emdash/chat-ui';
import {
  MOBILE_ACCESS_PROTOCOL_VERSION,
  mobileAccessContract,
  type MobileAcpSnapshot,
  type MobileCatalog,
  type MobileDiffEntry,
  type MobileFileEntry,
  type MobileResource,
  type MobileResourceHandle,
} from '@emdash/core/mobile-access';
import {
  client as createContractClient,
  connect as connectWire,
  reconnectingWebSocketTransport,
  type Connection,
  type ReconnectingTransport,
} from '@emdash/wire';
import type {
  AcpResourceHandle,
  AcpPromptInput,
  BootstrapState,
  BrowserResourceHandle,
  Catalog,
  ConnectionListener,
  ConnectionStatus,
  CreateOptions,
  CreateResourceRequest,
  DiffLine,
  DiffResourceHandle,
  DraftUpdateResult,
  FileResourceHandle,
  MobileClient,
  MobileEvent,
  MobileEventListener,
  PromptAttachment,
  PtyResourceHandle,
  ResourceCategory,
  ResourceHandle,
  ResourceSummary,
  TranscriptExport,
} from './types';

type SessionResponse = {
  authenticated: boolean;
  client?: { id: string; name: string };
};

type IndexedResource =
  | { source: 'catalog'; value: MobileResource }
  | { source: 'file'; taskId: string; value: MobileFileEntry }
  | { source: 'diff'; taskId: string; value: MobileDiffEntry };

type OpenResource = {
  resourceId?: string;
  kind?: 'acp' | 'conversation' | 'terminal';
  serverHandleId?: string;
  unsubscribe?: () => void;
  pollTimer?: number;
  pollBusy?: boolean;
};

type AsyncAttempt = {
  generation: number;
  promise: Promise<void>;
};

type RehydrateAttempt = AsyncAttempt & {
  cycle: number;
};

const rehydrateRetryDelays = [250, 1_000, 2_500, 5_000] as const;
const catalogPollIntervalMs = 2_500;

export interface BrowserMobileClientOptions {
  apiBase?: string;
  socketPath?: string;
}

export function toWebSocketUrl(locationUrl: string, socketPath: string): string {
  const url = new URL(socketPath, locationUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

function makeContractClient(connection: Connection) {
  return createContractClient(mobileAccessContract, connection);
}

type MobileContractClient = ReturnType<typeof makeContractClient>;

export class BrowserMobileClient implements MobileClient {
  private readonly apiBase: string;
  private readonly socketUrl: string;
  private readonly listeners = new Set<MobileEventListener>();
  private readonly connectionListeners = new Set<ConnectionListener>();
  private readonly resourceIndex = new Map<string, IndexedResource>();
  private readonly summaries = new Map<string, ResourceSummary>();
  private readonly openResources = new Map<string, OpenResource>();
  private readonly acpHistories = new Map<string, TranscriptTurn[]>();
  private transport: ReconnectingTransport | null = null;
  private wire: MobileContractClient | null = null;
  private authenticated = false;
  private disposed = false;
  private needsRehydrate = false;
  private connectionGeneration = 0;
  private connectionAbort = new AbortController();
  private connectionAttempt: AsyncAttempt | null = null;
  private rehydrateCycle = 0;
  private rehydrateAttempt: RehydrateAttempt | null = null;
  private rehydrateRetryTimer: number | null = null;
  private rehydrateRetryStep = 0;
  private sessionCheckTimer: number | null = null;
  private catalogPollTimer: number | null = null;
  private catalogPollBusy = false;
  private serverCatalog: MobileCatalog | null = null;

  connectionStatus: ConnectionStatus = 'connecting';

  constructor(options: BrowserMobileClientOptions = {}) {
    this.apiBase = options.apiBase ?? '/api';
    this.socketUrl = toWebSocketUrl(window.location.href, options.socketPath ?? '/api/ws');
    window.addEventListener('online', this.handleOnline);
    window.addEventListener('offline', this.handleOffline);
  }

  async bootstrap(): Promise<BootstrapState> {
    this.setConnectionStatus('connecting');
    const session = await this.getSession();
    this.authenticated = session.authenticated;
    if (!session.authenticated) {
      this.setConnectionStatus('online');
      return { authenticated: false };
    }
    return await this.initializeAuthenticated();
  }

  async pair(code: string): Promise<BootstrapState> {
    await this.http('/pair', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: code.replace(/\D/g, ''), deviceName: deviceName() }),
    });
    this.authenticated = true;
    return await this.initializeAuthenticated();
  }

  async logout(): Promise<void> {
    await this.http('/logout', { method: 'POST' });
    this.authenticated = false;
    this.closeConnection();
    this.setConnectionStatus('online');
  }

  async getResources(
    taskId: string,
    category: ResourceCategory,
    path = ''
  ): Promise<ResourceSummary[]> {
    const wire = await this.requireWire();
    if (category === 'files') {
      const entries = unwrap(await wire.files.list({ taskId, path }));
      return entries.map((entry) => this.indexFile(taskId, entry));
    }
    if (category === 'changes') {
      const entries = unwrap(await wire.diffs.list({ taskId }));
      return entries.map((entry) => this.indexDiff(taskId, entry));
    }

    const catalog = unwrap(await wire.catalog(undefined));
    this.acceptCatalog(catalog, true);
    const resources = catalog.resources.filter((resource) => {
      if (resource.taskId !== taskId) return false;
      if (category === 'conversations') {
        return resource.kind === 'acp' || resource.kind === 'conversation';
      }
      if (category === 'terminals') return resource.kind === 'terminal';
      return resource.kind === 'browser';
    });
    return resources.map((resource) => this.indexCatalogResource(resource));
  }

  async openResource(resourceId: string): Promise<ResourceHandle> {
    const indexed = this.resourceIndex.get(resourceId);
    const summary = this.summaries.get(resourceId);
    if (!indexed || !summary) throw new Error('This resource is no longer available.');
    const wire = await this.requireWire();

    if (indexed.source === 'file') {
      if (indexed.value.kind === 'directory') {
        throw new Error('Choose a file inside this folder.');
      }
      const read = unwrap(
        await wire.files.read({ taskId: indexed.taskId, path: indexed.value.path })
      );
      const handle: FileResourceHandle = {
        handleId: resourceId,
        summary,
        kind: 'file',
        path: read.path,
        content: read.kind === 'text' ? (read.content ?? undefined) : undefined,
        imageUrl: read.kind === 'image' ? (read.content ?? undefined) : undefined,
        language: languageForPath(read.path),
        binary: read.kind === 'binary',
        truncated: read.truncated,
        size: read.totalSize,
      };
      this.openResources.set(handle.handleId, {});
      return handle;
    }

    if (indexed.source === 'diff') {
      const read = unwrap(
        await wire.diffs.read({
          taskId: indexed.taskId,
          path: indexed.value.path,
          staged: indexed.value.staged,
        })
      );
      const lines = parseDiff(read.patch ?? '');
      const handle: DiffResourceHandle = {
        handleId: resourceId,
        summary,
        kind: 'diff',
        path: read.path,
        staged: indexed.value.staged,
        additions:
          indexed.value.additions ?? lines.filter((line) => line.kind === 'addition').length,
        deletions:
          indexed.value.deletions ?? lines.filter((line) => line.kind === 'deletion').length,
        lines,
        truncated: read.truncated,
      };
      this.openResources.set(handle.handleId, {});
      return handle;
    }

    const resource = indexed.value;
    if (resource.kind === 'browser') {
      const handle: BrowserResourceHandle = {
        handleId: resourceId,
        summary,
        kind: 'browser',
        url: resource.url,
        openable: resource.openable,
        warning: resource.unavailableReason,
      };
      this.openResources.set(handle.handleId, {});
      return handle;
    }

    const opened = unwrap(
      await wire.openResource({ kind: resource.kind, resourceId: resource.id })
    );
    if (opened.kind === 'acp') return await this.openAcp(opened, summary, wire);
    return await this.openPty(opened, summary, resource.kind === 'conversation', wire);
  }

  async closeResource(handleId: string): Promise<void> {
    const open = this.openResources.get(handleId);
    if (!open) return;
    this.openResources.delete(handleId);
    this.acpHistories.delete(handleId);
    open.unsubscribe?.();
    if (open.pollTimer !== undefined) window.clearTimeout(open.pollTimer);
    const wire = this.wire;
    if (open.serverHandleId && wire) await this.closeServerHandle(wire, open.serverHandleId);
  }

  async getCreateOptions(taskId: string): Promise<CreateOptions> {
    const wire = await this.requireWire();
    const options = unwrap(await wire.creationOptions({ taskId }));
    return {
      defaultAgentId: options.defaultAgentId ?? undefined,
      defaultShellId: options.defaultShellId,
      autoApproveByDefault: options.autoApproveByDefault,
      agents: options.agents.map((agent) => ({
        id: agent.id,
        name: agent.name,
        installed: true,
        interfaces: [
          ...(agent.supportsAcp ? (['acp'] as const) : []),
          ...(agent.supportsPty ? (['terminal'] as const) : []),
        ],
        models: agent.models,
        supportsAutoApprove: agent.supportsAutoApprove,
      })),
      shells: options.shells
        .filter((shell) => shell.available)
        .map(({ id, name }) => ({ id, name })),
    };
  }

  async createResource(request: CreateResourceRequest): Promise<ResourceSummary> {
    const wire = await this.requireWire();
    let handle: MobileResourceHandle;
    if (request.kind === 'terminal') {
      handle = unwrap(
        await wire.createTerminal({
          requestId: request.requestId,
          taskId: request.taskId,
          shellId: request.shellId,
        })
      );
    } else {
      if (!request.agentId) throw new Error('Choose an agent.');
      handle = unwrap(
        await wire.createAgent({
          requestId: request.requestId,
          taskId: request.taskId,
          interface: request.kind === 'acp' ? 'acp' : 'pty',
          providerId: request.agentId,
          model: request.modelId,
          autoApprove: request.autoApprove,
        })
      );
    }
    const resource: MobileResource =
      handle.kind === 'terminal'
        ? {
            kind: 'terminal',
            id: handle.resourceId,
            projectId: '',
            taskId: request.taskId,
            title: handle.title,
            shellId: request.kind === 'terminal' ? (request.shellId ?? 'system') : 'system',
            runtimeAvailable: true,
          }
        : {
            kind: handle.kind,
            id: handle.resourceId,
            projectId: '',
            taskId: request.taskId,
            title: handle.title,
            providerId: request.kind === 'terminal' ? '' : (request.agentId ?? ''),
            status: null,
            seen: true,
            runtimeAvailable: true,
          };
    const summary = this.indexCatalogResource(resource);
    return summary;
  }

  async renameResource(resourceId: string, title: string): Promise<ResourceSummary> {
    const indexed = this.resourceIndex.get(resourceId);
    const summary = this.summaries.get(resourceId);
    if (!indexed || indexed.source !== 'catalog' || !summary) {
      throw new Error('Only sessions can be renamed.');
    }
    const resource = indexed.value;
    if (resource.kind === 'browser') throw new Error('Browser tabs are renamed on the desktop.');
    const wire = await this.requireWire();
    const current = [...this.openResources.values()].find(
      (value) => value.resourceId === resourceId && value.serverHandleId
    );
    let temporary: MobileResourceHandle | undefined;
    try {
      temporary = current
        ? undefined
        : unwrap(await wire.openResource({ kind: resource.kind, resourceId: resource.id }));
      const handleId = current?.serverHandleId ?? temporary?.id;
      if (!handleId) throw new Error('Could not open this session.');
      unwrap(await wire.renameResource({ handleId, name: title }));
      const next = { ...summary, title };
      this.summaries.set(resourceId, next);
      this.emit({ type: 'resource.renamed', resourceId, title });
      return next;
    } finally {
      if (temporary) await this.closeServerHandle(wire, temporary.id);
    }
  }

  async sendPrompt(
    handleId: string,
    input: AcpPromptInput,
    attachments: PromptAttachment[]
  ): Promise<void> {
    await this.submitPrompt(handleId, input, attachments, false);
    void this.refreshAcp(handleId);
  }

  async queuePrompt(
    handleId: string,
    input: AcpPromptInput,
    attachments: PromptAttachment[]
  ): Promise<void> {
    await this.submitPrompt(handleId, input, attachments, true);
    void this.refreshAcp(handleId);
  }

  async editQueuedPrompt(handleId: string, promptId: string, input: AcpPromptInput): Promise<void> {
    const wire = await this.requireWire();
    unwrap(
      await wire.acp.editQueuedPrompt({
        handleId: this.serverHandle(handleId),
        id: promptId,
        input,
      })
    );
    void this.refreshAcp(handleId);
  }

  async deleteQueuedPrompt(handleId: string, promptId: string): Promise<void> {
    const wire = await this.requireWire();
    unwrap(
      await wire.acp.deleteQueuedPrompt({
        handleId: this.serverHandle(handleId),
        id: promptId,
      })
    );
    void this.refreshAcp(handleId);
  }

  async reorderQueuedPrompts(handleId: string, promptIds: string[]): Promise<void> {
    const wire = await this.requireWire();
    unwrap(
      await wire.acp.reorderQueuedPrompts({
        handleId: this.serverHandle(handleId),
        ids: promptIds,
      })
    );
    void this.refreshAcp(handleId);
  }

  async exportTranscript(handleId: string, format: 'parsed' | 'raw'): Promise<TranscriptExport> {
    const wire = await this.requireWire();
    const download = unwrap(
      await wire.acp.exportTranscript({ handleId: this.serverHandle(handleId), format })
    );
    return {
      name: download.meta.name,
      mimeType: download.meta.mimeType,
      content: new TextDecoder().decode(await download.bytes()),
    };
  }

  private async submitPrompt(
    handleId: string,
    input: AcpPromptInput,
    attachments: PromptAttachment[],
    queue: boolean
  ): Promise<void> {
    const wire = await this.requireWire();
    const serverHandleId = this.serverHandle(handleId);
    const uploaded: Array<{ id: string; name: string; mimeType: PromptAttachment['mimeType'] }> =
      [];
    try {
      for (const attachment of attachments) {
        const result = await wire.acp.uploadAttachment(
          { handleId: serverHandleId },
          {
            name: attachment.name,
            mimeType: attachment.mimeType,
            size: attachment.bytes.byteLength,
            source: byteSource(attachment.bytes),
          }
        );
        uploaded.push(unwrap(result));
      }
    } catch (error) {
      await this.deleteUploadedAttachments(wire, serverHandleId, uploaded);
      throw error;
    }
    const prompt: AcpPromptInput = {
      text: input.text,
      ...(input.hiddenContext === undefined ? {} : { hiddenContext: input.hiddenContext }),
      ...((input.attachments?.length ?? 0) + uploaded.length === 0
        ? {}
        : {
            attachments: [
              ...(input.attachments ?? []),
              ...uploaded.map((attachment) => ({
                type: 'attachment' as const,
                ...attachment,
              })),
            ],
          }),
    };
    const result = queue
      ? await wire.acp.queuePrompt({ handleId: serverHandleId, prompt })
      : await wire.acp.sendPrompt({ handleId: serverHandleId, prompt });
    if (!result.success) {
      await this.deleteUploadedAttachments(wire, serverHandleId, uploaded);
      unwrap(result);
    }
  }

  private async deleteUploadedAttachments(
    wire: MobileContractClient,
    serverHandleId: string,
    attachments: Array<{ id: string }>
  ): Promise<void> {
    await Promise.allSettled(
      attachments.map(async (attachment) => {
        unwrap(
          await wire.acp.deleteAttachment({
            handleId: serverHandleId,
            attachmentId: attachment.id,
          })
        );
      })
    );
  }

  async cancelPrompt(handleId: string): Promise<void> {
    const wire = await this.requireWire();
    unwrap(await wire.acp.cancel({ handleId: this.serverHandle(handleId) }));
    void this.refreshAcp(handleId);
  }

  async respondToPermission(handleId: string, requestId: string, optionId: string): Promise<void> {
    const wire = await this.requireWire();
    unwrap(
      await wire.acp.resolvePermission({
        handleId: this.serverHandle(handleId),
        decision: { requestId, optionId },
      })
    );
    void this.refreshAcp(handleId);
  }

  async updateAcpOption(
    handleId: string,
    option: 'model' | 'mode' | 'effort',
    value: string
  ): Promise<void> {
    const wire = await this.requireWire();
    unwrap(
      await wire.acp.setConfig({
        handleId: this.serverHandle(handleId),
        dimension: option,
        value,
      })
    );
    void this.refreshAcp(handleId);
  }

  async updateDraft(
    handleId: string,
    expectedRevision: number,
    input: AcpPromptInput
  ): Promise<DraftUpdateResult> {
    const wire = await this.requireWire();
    const result = unwrap(
      await wire.acp.setDraft({
        handleId: this.serverHandle(handleId),
        expectedRev: expectedRevision === 0 ? null : expectedRevision,
        input,
      })
    );
    return {
      accepted: result.status === 'applied',
      current: {
        revision: result.rev ?? 0,
        text: result.draft?.text ?? '',
        ...(result.draft?.hiddenContext === undefined
          ? {}
          : { hiddenContext: result.draft.hiddenContext }),
        ...(result.draft?.attachments === undefined
          ? {}
          : { attachments: result.draft.attachments }),
      },
    };
  }

  async sendPtyInput(handleId: string, data: string): Promise<void> {
    const wire = await this.requireWire();
    unwrap(await wire.pty.sendInput({ handleId: this.serverHandle(handleId), data }));
  }

  async resizePty(handleId: string, cols: number, rows: number): Promise<void> {
    const wire = await this.requireWire();
    unwrap(await wire.pty.resize({ handleId: this.serverHandle(handleId), cols, rows }));
  }

  subscribe(listener: MobileEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribeConnection(listener: ConnectionListener): () => void {
    this.connectionListeners.add(listener);
    listener(this.connectionStatus);
    return () => this.connectionListeners.delete(listener);
  }

  reconnect(): void {
    if (!this.authenticated || this.disposed) return;
    this.detachRemoteResources();
    const generation = this.invalidateConnection();
    this.setConnectionStatus('reconnecting');
    void this.ensureConnection().catch(() => {
      if (this.isCurrentGeneration(generation)) this.setConnectionStatus('offline');
    });
  }

  dispose(): void {
    this.disposed = true;
    this.closeConnection();
    window.removeEventListener('online', this.handleOnline);
    window.removeEventListener('offline', this.handleOffline);
  }

  private async initializeAuthenticated(): Promise<BootstrapState> {
    const wire = await this.requireWire();
    unwrap(await wire.initialize({ protocolVersion: MOBILE_ACCESS_PROTOCOL_VERSION }));
    this.serverCatalog = unwrap(await wire.catalog(undefined));
    this.setConnectionStatus('online');
    this.scheduleCatalogPoll();
    return {
      authenticated: true,
      deviceName: 'Emdash desktop',
      catalog: mapCatalog(this.serverCatalog),
    };
  }

  private async requireWire(): Promise<MobileContractClient> {
    await this.ensureConnection();
    if (!this.wire) throw new Error('Mobile connection is offline.');
    return this.wire;
  }

  private async ensureConnection(): Promise<void> {
    if (this.wire) return;
    if (!this.authenticated) throw new Error('Pair this phone with the desktop first.');
    if (this.disposed) throw new Error('The mobile connection has been closed.');
    const generation = this.connectionGeneration;
    const currentAttempt = this.connectionAttempt;
    if (currentAttempt?.generation === generation) {
      await currentAttempt.promise;
      return;
    }
    const promise = this.connectForGeneration(generation, this.connectionAbort.signal);
    const attempt = { generation, promise };
    this.connectionAttempt = attempt;
    const clearAttempt = (): void => {
      if (this.connectionAttempt === attempt) this.connectionAttempt = null;
    };
    void promise.then(clearAttempt, clearAttempt);
    await promise;
  }

  private async connectForGeneration(generation: number, signal: AbortSignal): Promise<void> {
    if (!this.isCurrentGeneration(generation)) return;
    this.setConnectionStatus(this.connectionStatus === 'offline' ? 'reconnecting' : 'connecting');
    const transport = reconnectingWebSocketTransport(() => new WebSocket(this.socketUrl), {
      backoffMs: [250, 500, 1_000, 2_000, 5_000],
      maxQueuedMessages: 128,
    });
    if (!this.isCurrentGeneration(generation)) {
      transport.close();
      return;
    }
    const wire = makeContractClient(connectWire(transport));
    this.transport = transport;
    this.wire = wire;
    transport.onDisconnect(() => {
      if (!this.isCurrentConnection(generation, wire, transport)) return;
      this.rehydrateCycle += 1;
      this.rehydrateAttempt = null;
      this.clearRehydrateRetry();
      this.clearCatalogPoll();
      this.detachRemoteResources();
      this.setConnectionStatus('reconnecting');
      this.scheduleSessionCheck();
    });
    transport.onReconnect(() => {
      if (!this.isCurrentConnection(generation, wire, transport)) return;
      void this.rehydrateOpenResources(generation, wire).catch(() => {
        if (!this.isCurrentConnection(generation, wire, transport)) return;
        this.transport = null;
        this.wire = null;
        transport.close();
        this.setConnectionStatus('offline');
        this.scheduleSessionCheck();
      });
    });
    try {
      await wire.health(undefined, { signal });
      if (!this.isCurrentConnection(generation, wire, transport)) return;
      if (this.needsRehydrate) await this.rehydrateOpenResources(generation, wire);
      if (!this.isCurrentConnection(generation, wire, transport)) return;
      this.clearSessionCheck();
      this.setConnectionStatus('online');
    } catch (error) {
      if (this.isCurrentConnection(generation, wire, transport)) {
        this.transport = null;
        this.wire = null;
        transport.close();
      }
      throw error;
    }
  }

  private closeConnection(): void {
    this.invalidateConnection();
    for (const open of this.openResources.values()) {
      open.unsubscribe?.();
      if (open.pollTimer !== undefined) window.clearTimeout(open.pollTimer);
    }
    this.openResources.clear();
    this.needsRehydrate = false;
    this.clearSessionCheck();
  }

  private invalidateConnection(): number {
    this.connectionGeneration += 1;
    this.connectionAbort.abort();
    this.connectionAbort = new AbortController();
    this.connectionAttempt = null;
    this.rehydrateCycle += 1;
    this.rehydrateAttempt = null;
    this.clearRehydrateRetry();
    this.clearCatalogPoll();
    const transport = this.transport;
    this.transport = null;
    this.wire = null;
    transport?.close();
    return this.connectionGeneration;
  }

  private isCurrentGeneration(generation: number): boolean {
    return generation === this.connectionGeneration && !this.disposed && this.authenticated;
  }

  private isCurrentConnection(
    generation: number,
    wire: MobileContractClient,
    transport?: ReconnectingTransport
  ): boolean {
    return (
      this.isCurrentGeneration(generation) &&
      this.wire === wire &&
      (transport === undefined || this.transport === transport)
    );
  }

  private detachRemoteResources(): void {
    let detached = false;
    for (const open of this.openResources.values()) {
      if (!open.kind) continue;
      detached = true;
      open.unsubscribe?.();
      open.unsubscribe = undefined;
      open.serverHandleId = undefined;
    }
    if (detached) this.needsRehydrate = true;
  }

  private rehydrateOpenResources(generation: number, wire: MobileContractClient): Promise<void> {
    const cycle = this.rehydrateCycle;
    const currentAttempt = this.rehydrateAttempt;
    if (currentAttempt?.generation === generation && currentAttempt.cycle === cycle) {
      return currentAttempt.promise;
    }
    const promise = this.performRehydrate(generation, cycle, wire, this.connectionAbort.signal);
    const attempt = { generation, cycle, promise };
    this.rehydrateAttempt = attempt;
    const clearAttempt = (): void => {
      if (this.rehydrateAttempt === attempt) this.rehydrateAttempt = null;
    };
    void promise.then(clearAttempt, clearAttempt);
    return promise;
  }

  private async performRehydrate(
    generation: number,
    cycle: number,
    wire: MobileContractClient,
    signal: AbortSignal
  ): Promise<void> {
    if (!this.isCurrentRehydrate(generation, cycle, wire)) return;
    if (!this.needsRehydrate) {
      this.clearRehydrateRetry();
      this.clearSessionCheck();
      this.setConnectionStatus('online');
      this.scheduleCatalogPoll();
      return;
    }
    unwrap(await wire.initialize({ protocolVersion: MOBILE_ACCESS_PROTOCOL_VERSION }, { signal }));
    if (!this.isCurrentRehydrate(generation, cycle, wire)) return;
    let hasFailures = false;
    for (const [handleId, open] of [...this.openResources]) {
      if (!open.kind || !open.resourceId || open.serverHandleId) continue;
      const summary = this.summaries.get(open.resourceId);
      if (!summary) continue;
      try {
        await this.rehydrateResource(generation, cycle, wire, signal, handleId, open, summary);
      } catch {
        if (!this.isCurrentRehydrate(generation, cycle, wire)) return;
        hasFailures = true;
      }
      if (!this.isCurrentRehydrate(generation, cycle, wire)) return;
    }
    this.needsRehydrate = hasFailures;
    if (hasFailures) this.scheduleRehydrateRetry(generation, wire);
    else this.clearRehydrateRetry();
    this.clearSessionCheck();
    this.setConnectionStatus('online');
    this.scheduleCatalogPoll();
  }

  private scheduleRehydrateRetry(generation: number, wire: MobileContractClient): void {
    if (this.rehydrateRetryTimer !== null || !this.isCurrentConnection(generation, wire)) return;
    const delay =
      rehydrateRetryDelays[Math.min(this.rehydrateRetryStep, rehydrateRetryDelays.length - 1)];
    this.rehydrateRetryStep += 1;
    this.rehydrateRetryTimer = window.setTimeout(() => {
      this.rehydrateRetryTimer = null;
      if (!this.isCurrentConnection(generation, wire) || !this.needsRehydrate) return;
      void this.rehydrateOpenResources(generation, wire).catch(() => {
        if (this.isCurrentConnection(generation, wire)) {
          this.scheduleRehydrateRetry(generation, wire);
        }
      });
    }, delay);
  }

  private clearRehydrateRetry(): void {
    if (this.rehydrateRetryTimer !== null) {
      window.clearTimeout(this.rehydrateRetryTimer);
      this.rehydrateRetryTimer = null;
    }
    this.rehydrateRetryStep = 0;
  }

  private async rehydrateResource(
    generation: number,
    cycle: number,
    wire: MobileContractClient,
    signal: AbortSignal,
    handleId: string,
    open: OpenResource,
    summary: ResourceSummary
  ): Promise<void> {
    const kind = open.kind;
    const resourceId = open.resourceId;
    if (!kind || !resourceId) return;
    let reopenedHandleId: string | undefined;
    let pendingUnsubscribe: (() => void) | undefined;
    try {
      const reopened = unwrap(await wire.openResource({ kind, resourceId }, { signal }));
      reopenedHandleId = reopened.id;
      if (!this.isCurrentOpenResource(generation, cycle, wire, handleId, open)) {
        await this.closeServerHandle(wire, reopened.id);
        return;
      }
      if (kind === 'acp') {
        const snapshot = await this.loadAcpSnapshot(reopened.id, wire, signal);
        if (!this.isCurrentOpenResource(generation, cycle, wire, handleId, open)) {
          await this.closeServerHandle(wire, reopened.id);
          return;
        }
        const transcript = mergeTranscript(
          this.acpHistories.get(handleId) ?? [],
          transcriptForSnapshot(snapshot)
        );
        open.serverHandleId = reopened.id;
        this.acpHistories.set(handleId, transcript);
        this.emit({
          type: 'resource.changed',
          handle: mapAcpHandle(handleId, summary, snapshot, transcript),
        });
        return;
      }
      const attached = await this.attachPtyOutput(
        handleId,
        reopened.id,
        summary,
        kind === 'conversation',
        wire
      );
      pendingUnsubscribe = attached.unsubscribe;
      if (!this.isCurrentOpenResource(generation, cycle, wire, handleId, open)) {
        pendingUnsubscribe();
        pendingUnsubscribe = undefined;
        await this.closeServerHandle(wire, reopened.id);
        return;
      }
      open.serverHandleId = reopened.id;
      open.unsubscribe = pendingUnsubscribe;
      pendingUnsubscribe = undefined;
      this.emit({ type: 'resource.changed', handle: attached.handle });
    } catch (error) {
      pendingUnsubscribe?.();
      if (reopenedHandleId) await this.closeServerHandle(wire, reopenedHandleId);
      throw error;
    }
  }

  private isCurrentOpenResource(
    generation: number,
    cycle: number,
    wire: MobileContractClient,
    handleId: string,
    open: OpenResource
  ): boolean {
    return (
      this.isCurrentRehydrate(generation, cycle, wire) && this.openResources.get(handleId) === open
    );
  }

  private isCurrentRehydrate(
    generation: number,
    cycle: number,
    wire: MobileContractClient
  ): boolean {
    return this.rehydrateCycle === cycle && this.isCurrentConnection(generation, wire);
  }

  private scheduleSessionCheck(): void {
    if (this.sessionCheckTimer !== null || this.disposed || !this.authenticated) return;
    this.sessionCheckTimer = window.setTimeout(() => {
      this.sessionCheckTimer = null;
      void this.getSession().then(
        (session) => {
          if (!session.authenticated) {
            this.authenticated = false;
            this.closeConnection();
            window.location.reload();
            return;
          }
          if (this.connectionStatus !== 'online') this.scheduleSessionCheck();
        },
        () => {
          if (this.connectionStatus !== 'online') this.scheduleSessionCheck();
        }
      );
    }, 2_000);
  }

  private clearSessionCheck(): void {
    if (this.sessionCheckTimer === null) return;
    window.clearTimeout(this.sessionCheckTimer);
    this.sessionCheckTimer = null;
  }

  private scheduleCatalogPoll(): void {
    if (
      this.catalogPollTimer !== null ||
      this.disposed ||
      !this.authenticated ||
      !this.wire ||
      this.connectionStatus !== 'online'
    ) {
      return;
    }
    this.catalogPollTimer = window.setTimeout(() => {
      this.catalogPollTimer = null;
      void this.pollCatalog().finally(() => this.scheduleCatalogPoll());
    }, catalogPollIntervalMs);
  }

  private async pollCatalog(): Promise<void> {
    const wire = this.wire;
    if (!wire || this.catalogPollBusy || this.disposed || !this.authenticated) return;
    this.catalogPollBusy = true;
    try {
      const catalog = unwrap(await wire.catalog(undefined));
      if (this.wire === wire && !this.disposed && this.authenticated) {
        this.acceptCatalog(catalog, true);
      }
    } catch {
      // A later poll or the reconnect flow will retry.
    } finally {
      this.catalogPollBusy = false;
    }
  }

  private acceptCatalog(catalog: MobileCatalog, emitChange: boolean): void {
    const changed = this.serverCatalog !== null && this.serverCatalog.revision !== catalog.revision;
    this.serverCatalog = catalog;
    if (changed && emitChange) this.emit({ type: 'catalog.changed', catalog: mapCatalog(catalog) });
  }

  private clearCatalogPoll(): void {
    if (this.catalogPollTimer === null) return;
    window.clearTimeout(this.catalogPollTimer);
    this.catalogPollTimer = null;
  }

  private async openAcp(
    opened: MobileResourceHandle,
    summary: ResourceSummary,
    wire: MobileContractClient
  ): Promise<AcpResourceHandle> {
    try {
      const snapshot = await this.loadAcpSnapshot(opened.id, wire);
      const transcript = transcriptForSnapshot(snapshot);
      this.acpHistories.set(opened.id, transcript);
      const handle = mapAcpHandle(opened.id, summary, snapshot, transcript);
      this.openResources.set(handle.handleId, {
        resourceId: opened.resourceId,
        kind: 'acp',
        serverHandleId: opened.id,
      });
      this.scheduleAcpPoll(handle.handleId);
      return handle;
    } catch (error) {
      this.openResources.delete(opened.id);
      this.acpHistories.delete(opened.id);
      await this.closeServerHandle(wire, opened.id);
      throw error;
    }
  }

  private async openPty(
    opened: MobileResourceHandle,
    summary: ResourceSummary,
    agentTerminal: boolean,
    wire: MobileContractClient
  ): Promise<PtyResourceHandle> {
    let unsubscribe: (() => void) | undefined;
    try {
      const attached = await this.attachPtyOutput(
        opened.id,
        opened.id,
        summary,
        agentTerminal,
        wire
      );
      unsubscribe = attached.unsubscribe;
      this.openResources.set(attached.handle.handleId, {
        resourceId: opened.resourceId,
        kind: opened.kind,
        serverHandleId: opened.id,
        unsubscribe,
      });
      unsubscribe = undefined;
      return attached.handle;
    } catch (error) {
      unsubscribe?.();
      this.openResources.delete(opened.id);
      await this.closeServerHandle(wire, opened.id);
      throw error;
    }
  }

  private async attachPtyOutput(
    uiHandleId: string,
    serverHandleId: string,
    summary: ResourceSummary,
    agentTerminal: boolean,
    wire: MobileContractClient
  ): Promise<{ handle: PtyResourceHandle; unsubscribe: () => void }> {
    const output = wire.pty.output.handle({ handleId: serverHandleId });
    const pending: Array<{ sequence: number; delta: unknown }> = [];
    let live = false;
    const emitChunk = (delta: unknown): string => {
      const value = delta as { chunk?: unknown };
      if (typeof value.chunk !== 'string') return '';
      if (live) this.emit({ type: 'pty.data', handleId: uiHandleId, data: value.chunk });
      const exit = /\[Process exited with code (-?\d+)\]/.exec(value.chunk);
      if (live && exit) {
        this.emit({ type: 'pty.exit', handleId: uiHandleId, exitCode: Number(exit[1]) });
      }
      return value.chunk;
    };
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = await output.attach(
        (update) => {
          if (!live) pending.push(update);
          else emitChunk(update.delta);
        },
        {
          onReattach: () => {
            void output.snapshot().then(
              (next) => {
                if (this.openResources.get(uiHandleId)?.serverHandleId !== serverHandleId) {
                  return;
                }
                this.emit({
                  type: 'resource.changed',
                  handle: {
                    handleId: uiHandleId,
                    summary,
                    kind: agentTerminal ? 'agent-terminal' : 'terminal',
                    snapshot: next.data.text,
                    cols: 80,
                    rows: 24,
                    exited: false,
                  },
                });
              },
              () => undefined
            );
          },
        }
      );
      const snapshot = await output.snapshot();
      const trailing = pending
        .filter((update) => update.sequence > snapshot.sequence)
        .map((update) => emitChunk(update.delta))
        .join('');
      const handle: PtyResourceHandle = {
        handleId: uiHandleId,
        summary,
        kind: agentTerminal ? 'agent-terminal' : 'terminal',
        snapshot: snapshot.data.text + trailing,
        cols: 80,
        rows: 24,
        exited: false,
      };
      live = true;
      return { handle, unsubscribe };
    } catch (error) {
      unsubscribe?.();
      throw error;
    }
  }

  private async loadAcpSnapshot(
    handleId: string,
    wire?: MobileContractClient,
    signal?: AbortSignal
  ): Promise<MobileAcpSnapshot> {
    const client = wire ?? (await this.requireWire());
    const options = signal ? { signal } : undefined;
    let snapshot = unwrap(await client.acp.snapshot({ handleId }, options));
    const turns = [...snapshot.history.turns];
    let before = snapshot.history.nextCursor;
    const seenCursors = new Set<number>();
    while (before !== null) {
      if (seenCursors.has(before)) {
        throw new Error('The desktop returned a repeated transcript cursor.');
      }
      seenCursors.add(before);
      const previous = unwrap(await client.acp.snapshot({ handleId, before }, options));
      turns.unshift(...previous.history.turns);
      const next = previous.history.nextCursor;
      if (next !== null && next >= before) {
        throw new Error('The desktop returned a non-progressing transcript cursor.');
      }
      before = next;
    }
    snapshot = { ...snapshot, history: { turns, nextCursor: before } };
    return snapshot;
  }

  private async closeServerHandle(wire: MobileContractClient, handleId: string): Promise<void> {
    try {
      unwrap(await wire.closeResource({ handleId }));
    } catch {
      // Closing is cleanup: a disconnected domain has already released its handles.
    }
  }

  private scheduleAcpPoll(handleId: string): void {
    const open = this.openResources.get(handleId);
    if (!open) return;
    open.pollTimer = window.setTimeout(() => {
      void this.refreshAcp(handleId).finally(() => this.scheduleAcpPoll(handleId));
    }, 750);
  }

  private async refreshAcp(handleId: string): Promise<void> {
    const open = this.openResources.get(handleId);
    const summary = this.summaries.get(this.resourceIdForHandle(handleId));
    const wire = this.wire;
    const serverHandleId = open?.serverHandleId;
    if (!serverHandleId || open.pollBusy || !summary || !wire) return;
    open.pollBusy = true;
    try {
      const snapshot = unwrap(await wire.acp.snapshot({ handleId: serverHandleId }));
      if (
        this.wire !== wire ||
        this.openResources.get(handleId) !== open ||
        open.serverHandleId !== serverHandleId
      ) {
        return;
      }
      const transcript = mergeTranscript(
        this.acpHistories.get(handleId) ?? [],
        transcriptForSnapshot(snapshot)
      );
      this.acpHistories.set(handleId, transcript);
      const handle = mapAcpHandle(handleId, summary, snapshot, transcript);
      this.emit({ type: 'resource.changed', handle });
      this.emit({ type: 'acp.transcript', handleId, transcript: handle.transcript });
      this.emit({ type: 'acp.working', handleId, isWorking: handle.isWorking });
      this.emit({ type: 'acp.draft', handleId, draft: handle.draft });
    } catch {
      // The reconnecting transport will update status and the next poll will retry.
    } finally {
      open.pollBusy = false;
    }
  }

  private resourceIdForHandle(handleId: string): string {
    return (
      this.openResources.get(handleId)?.resourceId ?? (this.summaries.has(handleId) ? handleId : '')
    );
  }

  private serverHandle(handleId: string): string {
    const serverHandle = this.openResources.get(handleId)?.serverHandleId;
    if (!serverHandle) throw new Error('This session is no longer open.');
    return serverHandle;
  }

  private indexCatalogResource(resource: MobileResource): ResourceSummary {
    const summary = mapResource(resource);
    this.resourceIndex.set(summary.id, { source: 'catalog', value: resource });
    this.summaries.set(summary.id, summary);
    return summary;
  }

  private indexFile(taskId: string, entry: MobileFileEntry): ResourceSummary {
    const id = `file:${taskId}:${entry.path}`;
    const summary: ResourceSummary = {
      id,
      taskId,
      kind: 'file',
      title: entry.name,
      subtitle: entry.kind === 'directory' ? entry.path || 'Workspace root' : entry.path,
      badge: entry.kind === 'directory' ? 'Folder' : undefined,
      directory: entry.kind === 'directory',
      path: entry.path,
    };
    this.resourceIndex.set(id, { source: 'file', taskId, value: entry });
    this.summaries.set(id, summary);
    return summary;
  }

  private indexDiff(taskId: string, entry: MobileDiffEntry): ResourceSummary {
    const id = `diff:${taskId}:${entry.staged ? 'staged' : 'unstaged'}:${entry.path}`;
    const summary: ResourceSummary = {
      id,
      taskId,
      kind: 'diff',
      title: entry.path,
      subtitle: entry.staged ? 'Staged change' : 'Working tree change',
      status: 'changed',
      badge: entry.status,
      path: entry.path,
    };
    this.resourceIndex.set(id, { source: 'diff', taskId, value: entry });
    this.summaries.set(id, summary);
    return summary;
  }

  private emit(event: MobileEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private async http<T = void>(path: string, init?: RequestInit): Promise<T> {
    const headers = new Headers(init?.headers);
    if (!headers.has('accept')) headers.set('accept', 'application/json');
    const response = await fetch(`${this.apiBase}${path}`, {
      ...init,
      credentials: 'same-origin',
      headers,
    });
    const body: unknown = response.status === 204 ? undefined : await response.json();
    if (!response.ok) {
      const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
      throw new Error(pairingError(record.error, response.status));
    }
    return body as T;
  }

  private async getSession(): Promise<SessionResponse> {
    const response = await fetch(`${this.apiBase}/session`, {
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
    });
    const body: unknown = await response.json();
    if (response.status === 401) return { authenticated: false };
    if (!response.ok) {
      const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
      throw new Error(pairingError(record.error, response.status));
    }
    return body as SessionResponse;
  }

  private setConnectionStatus(status: ConnectionStatus): void {
    if (this.connectionStatus === status) return;
    this.connectionStatus = status;
    for (const listener of this.connectionListeners) listener(status);
  }

  private readonly handleOnline = (): void => {
    if (this.authenticated) this.reconnect();
  };

  private readonly handleOffline = (): void => {
    this.setConnectionStatus('offline');
  };
}

function unwrap<T, E>(result: { success: true; data: T } | { success: false; error: E }): T {
  if (result.success) return result.data;
  const error = result.error as { message?: unknown; code?: unknown };
  throw new Error(
    typeof error?.message === 'string'
      ? error.message
      : typeof error?.code === 'string'
        ? error.code
        : 'The desktop could not complete this request.'
  );
}

export function mapCatalog(catalog: MobileCatalog): Catalog {
  const counts = new Map<string, Partial<Record<ResourceCategory, number>>>();
  for (const resource of catalog.resources) {
    const taskCounts = counts.get(resource.taskId) ?? {};
    const category: ResourceCategory =
      resource.kind === 'terminal'
        ? 'terminals'
        : resource.kind === 'browser'
          ? 'browser'
          : 'conversations';
    taskCounts[category] = (taskCounts[category] ?? 0) + 1;
    counts.set(resource.taskId, taskCounts);
  }
  return {
    projects: catalog.projects.map((project) => ({ id: project.id, name: project.name })),
    tasks: catalog.tasks.map((task) => ({
      id: task.id,
      projectId: task.projectId,
      name: task.name,
      branch: task.lifecycleStatus,
      status:
        task.bootstrapStatus === 'ready'
          ? 'ready'
          : task.bootstrapStatus === 'not-started'
            ? 'dormant'
            : task.bootstrapStatus === 'error'
              ? 'unavailable'
              : 'provisioning',
      statusMessage: task.bootstrapMessage,
      counts: counts.get(task.id) ?? {},
    })),
  };
}

function mapResource(resource: MobileResource): ResourceSummary {
  if (resource.kind === 'browser') {
    return {
      id: resource.id,
      taskId: resource.taskId,
      kind: 'browser',
      title: resource.title,
      subtitle: resource.url,
      status: resource.openable ? 'idle' : 'attention',
    };
  }
  if (resource.kind === 'terminal') {
    return {
      id: resource.id,
      taskId: resource.taskId,
      kind: 'terminal',
      title: resource.title,
      subtitle: resource.shellId,
      status: resource.runtimeAvailable ? 'idle' : 'attention',
    };
  }
  return {
    id: resource.id,
    taskId: resource.taskId,
    kind: resource.kind === 'acp' ? 'acp' : 'agent-terminal',
    title: resource.title,
    subtitle: resource.providerId,
    status:
      resource.status === 'working' ? 'working' : resource.runtimeAvailable ? 'idle' : 'attention',
  };
}

export function mapAcpHandle(
  handleId: string,
  summary: ResourceSummary,
  snapshot: MobileAcpSnapshot,
  transcript: TranscriptTurn[] = transcriptForSnapshot(snapshot)
): AcpResourceHandle {
  const permission = snapshot.state.pendingPermissions[0];
  return {
    handleId,
    summary,
    kind: 'acp',
    transcript,
    draft: {
      revision: snapshot.draftRev ?? 0,
      text: snapshot.draft?.text ?? '',
      ...(snapshot.draft?.hiddenContext === undefined
        ? {}
        : { hiddenContext: snapshot.draft.hiddenContext }),
      ...(snapshot.draft?.attachments === undefined
        ? {}
        : { attachments: snapshot.draft.attachments }),
    },
    isWorking: snapshot.state.isGenerating,
    model: snapshot.config.modelOptions?.selected ?? undefined,
    mode: snapshot.config.modeOptions?.selected ?? undefined,
    effort: snapshot.config.efforts?.selected ?? undefined,
    availableModels: snapshot.config.modelOptions?.available ?? [],
    availableModes: snapshot.config.modeOptions?.available ?? [],
    availableEfforts: snapshot.config.efforts?.available ?? [],
    queue: snapshot.state.queuedPrompts.map((prompt) => ({
      id: prompt.id,
      text: prompt.text,
      ...(prompt.hiddenContext === undefined ? {} : { hiddenContext: prompt.hiddenContext }),
      ...(prompt.attachments === undefined ? {} : { attachments: prompt.attachments }),
    })),
    terminalOutputs: snapshot.terminals.map(({ terminalId, output }) => ({ terminalId, output })),
    permission: permission
      ? {
          id: permission.requestId,
          title: permission.toolCall.title,
          description: permission.toolCall.inputSummary,
          options: permission.options.map((option) => ({
            id: option.optionId,
            label: option.name,
            tone: option.kind.startsWith('reject') ? ('danger' as const) : ('default' as const),
          })),
        }
      : undefined,
  };
}

function transcriptForSnapshot(snapshot: MobileAcpSnapshot): TranscriptTurn[] {
  const turns = snapshot.history.turns as TranscriptTurn[];
  return mergeTranscript(turns, snapshot.activeTurn ? [snapshot.activeTurn as TranscriptTurn] : []);
}

function mergeTranscript(existing: TranscriptTurn[], incoming: TranscriptTurn[]): TranscriptTurn[] {
  const byId = new Map(existing.map((turn) => [turn.id, turn]));
  for (const turn of incoming) byId.set(turn.id, turn);
  return [...byId.values()].sort((left, right) => left.seq - right.seq);
}

function parseDiff(patch: string): DiffLine[] {
  const lines: DiffLine[] = [];
  let oldNumber = 0;
  let newNumber = 0;
  for (const raw of patch.split('\n')) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) {
      oldNumber = Number(hunk[1]);
      newNumber = Number(hunk[2]);
      lines.push({ kind: 'header', text: raw });
      continue;
    }
    if (raw.startsWith('+++') || raw.startsWith('---')) {
      lines.push({ kind: 'header', text: raw });
    } else if (raw.startsWith('+')) {
      lines.push({ kind: 'addition', newNumber: newNumber++, text: raw.slice(1) });
    } else if (raw.startsWith('-')) {
      lines.push({ kind: 'deletion', oldNumber: oldNumber++, text: raw.slice(1) });
    } else {
      lines.push({
        kind: 'context',
        oldNumber: oldNumber++,
        newNumber: newNumber++,
        text: raw.slice(1),
      });
    }
  }
  return lines;
}

function languageForPath(path: string): string | undefined {
  const extension = path.split('.').pop()?.toLowerCase();
  if (extension === 'md' || extension === 'mdx') return 'markdown';
  return extension;
}

async function* byteSource(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  yield bytes;
}

function deviceName(): string {
  return navigator.platform?.trim() || 'Mobile device';
}

function pairingError(code: unknown, status: number): string {
  if (code === 'invalid_pairing_code') return 'That pairing code is not valid.';
  if (code === 'pairing_code_expired') return 'That pairing code has expired.';
  if (code === 'pairing_attempts_exhausted') return 'Too many attempts. Generate a new code.';
  if (code === 'rate_limited') return 'Too many attempts. Wait a minute and try again.';
  if (status === 401) return 'This phone is not paired with Emdash.';
  return 'Could not reach Emdash on this network.';
}

/** Small immutable helper retained for catalog-store tests and optimistic count updates. */
export function replaceCatalogTask(catalog: Catalog, taskId: string, count: number): Catalog {
  return {
    ...catalog,
    tasks: catalog.tasks.map((task) =>
      task.id === taskId ? { ...task, counts: { ...task.counts, conversations: count } } : task
    ),
  };
}
