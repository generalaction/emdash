import type { TranscriptTurn } from '@emdash/chat-ui';
import type {
  AcpResourceHandle,
  AcpPromptInput,
  BootstrapState,
  Catalog,
  ConnectionListener,
  ConnectionStatus,
  CreateOptions,
  CreateResourceRequest,
  DiffLine,
  DraftUpdateResult,
  MobileClient,
  MobileEvent,
  MobileEventListener,
  PromptAttachment,
  ResourceCategory,
  ResourceHandle,
  ResourceSummary,
  TranscriptExport,
} from './types';

const catalog: Catalog = {
  projects: [
    { id: 'project:emdash', name: 'emdash', repository: 'generalaction/emdash' },
    { id: 'project:docs', name: 'product-docs', repository: 'generalaction/product-docs' },
  ],
  tasks: [
    {
      id: 'task:mobile',
      projectId: 'project:emdash',
      name: 'Mobile access',
      branch: 'emdash/mobile-view-510',
      status: 'ready',
      counts: { conversations: 2, terminals: 1, files: 5, changes: 3, browser: 1 },
    },
    {
      id: 'task:palette',
      projectId: 'project:emdash',
      name: 'Command palette polish',
      branch: 'feat/command-palette',
      status: 'ready',
      counts: { conversations: 1, terminals: 1, files: 3, changes: 1 },
    },
    {
      id: 'task:release',
      projectId: 'project:docs',
      name: 'Release notes',
      branch: 'docs/july-release',
      status: 'provisioning',
      statusMessage: 'Creating worktree…',
      counts: {},
    },
  ],
};

const resources: ResourceSummary[] = [
  {
    id: 'acp:mobile-plan',
    taskId: 'task:mobile',
    kind: 'acp',
    title: 'Implement mobile access',
    subtitle: 'Codex · GPT-5',
    status: 'working',
    badge: 'ACP',
  },
  {
    id: 'pty:security-review',
    taskId: 'task:mobile',
    kind: 'agent-terminal',
    title: 'Security review',
    subtitle: 'Claude Code',
    status: 'idle',
    badge: 'TUI',
  },
  {
    id: 'terminal:dev',
    taskId: 'task:mobile',
    kind: 'terminal',
    title: 'Dev server',
    subtitle: 'zsh · running',
    status: 'idle',
  },
  {
    id: 'file:app',
    taskId: 'task:mobile',
    kind: 'file',
    title: 'app.tsx',
    subtitle: 'apps/emdash-mobile/src/app.tsx',
  },
  {
    id: 'file:gateway',
    taskId: 'task:mobile',
    kind: 'file',
    title: 'mobile-gateway-service.ts',
    subtitle: 'apps/emdash-desktop/src/main/core/mobile-access',
  },
  {
    id: 'file:readme',
    taskId: 'task:mobile',
    kind: 'file',
    title: 'README.md',
    subtitle: 'README.md',
  },
  {
    id: 'file:package',
    taskId: 'task:mobile',
    kind: 'file',
    title: 'package.json',
    subtitle: 'apps/emdash-mobile/package.json',
  },
  {
    id: 'file:logo',
    taskId: 'task:mobile',
    kind: 'file',
    title: 'app-icon.png',
    subtitle: 'build/icon.png · 38 KB',
  },
  {
    id: 'diff:app',
    taskId: 'task:mobile',
    kind: 'diff',
    title: 'app.tsx',
    subtitle: 'Modified',
    status: 'changed',
    badge: '+42 −8',
  },
  {
    id: 'diff:gateway',
    taskId: 'task:mobile',
    kind: 'diff',
    title: 'mobile-gateway-service.ts',
    subtitle: 'Added',
    status: 'changed',
    badge: '+187',
  },
  {
    id: 'diff:styles',
    taskId: 'task:mobile',
    kind: 'diff',
    title: 'styles.css',
    subtitle: 'Staged',
    status: 'changed',
    badge: '+96 −14',
  },
  {
    id: 'browser:preview',
    taskId: 'task:mobile',
    kind: 'browser',
    title: 'Emdash Mobile Preview',
    subtitle: 'http://localhost:4173',
    status: 'attention',
  },
  {
    id: 'acp:palette',
    taskId: 'task:palette',
    kind: 'acp',
    title: 'Keyboard navigation',
    subtitle: 'Codex · GPT-5',
    status: 'idle',
  },
  {
    id: 'terminal:palette',
    taskId: 'task:palette',
    kind: 'terminal',
    title: 'Tests',
    subtitle: 'bash',
    status: 'exited',
  },
  {
    id: 'file:palette',
    taskId: 'task:palette',
    kind: 'file',
    title: 'command-menu.tsx',
    subtitle: 'src/renderer/features/command-palette',
  },
  {
    id: 'diff:palette',
    taskId: 'task:palette',
    kind: 'diff',
    title: 'command-menu.tsx',
    subtitle: 'Modified',
    status: 'changed',
    badge: '+18 −5',
  },
];

function messageTurn(
  id: string,
  seq: number,
  role: 'user' | 'assistant',
  text: string
): TranscriptTurn {
  return {
    id: `turn:${id}`,
    seq,
    initiator: role === 'user' ? 'user' : 'agent',
    items: [{ kind: 'message', id, seq: 0, role, text }],
    outcome: { kind: 'done' },
  };
}

const initialTranscript: TranscriptTurn[] = [
  messageTurn(
    'welcome-user',
    0,
    'user',
    'Build a secure mobile view that lets me work with this task from my phone.'
  ),
  messageTurn(
    'welcome-agent',
    1,
    'assistant',
    'I mapped the existing PTY and ACP runtimes. I’m adding a main-process gateway with opaque resource handles, short-lived pairing, and shared session leases.'
  ),
  messageTurn(
    'mobile-plan',
    2,
    'assistant',
    'Progress\n\n- ✓ Define the authenticated mobile contract\n- ◉ Build the responsive mobile client\n- ○ Connect PTY and ACP leases'
  ),
  messageTurn(
    'latest-agent',
    3,
    'assistant',
    'The mobile shell is ready. Next I’ll connect the real gateway transport and exercise reconnect behavior.'
  ),
];

const diffLines: DiffLine[] = [
  { kind: 'header', text: '@@ -18,8 +18,14 @@ export function App() {' },
  { kind: 'context', oldNumber: 18, newNumber: 18, text: '  const client = useMobileClient();' },
  { kind: 'deletion', oldNumber: 19, text: '  return <DesktopOnly />;' },
  { kind: 'addition', newNumber: 19, text: '  const session = useMobileSession(client);' },
  { kind: 'addition', newNumber: 20, text: '' },
  { kind: 'addition', newNumber: 21, text: '  if (!session.authenticated) {' },
  { kind: 'addition', newNumber: 22, text: '    return <PairScreen onPair={session.pair} />;' },
  { kind: 'addition', newNumber: 23, text: '  }' },
  { kind: 'context', oldNumber: 20, newNumber: 24, text: '' },
  { kind: 'addition', newNumber: 25, text: '  return <MobileShell catalog={session.catalog} />;' },
  { kind: 'context', oldNumber: 21, newNumber: 26, text: '}' },
];

function resourceCategory(kind: ResourceSummary['kind']): ResourceCategory {
  if (kind === 'acp' || kind === 'agent-terminal') return 'conversations';
  if (kind === 'terminal') return 'terminals';
  if (kind === 'file') return 'files';
  if (kind === 'diff') return 'changes';
  return 'browser';
}

export class MockMobileClient implements MobileClient {
  private readonly listeners = new Set<MobileEventListener>();
  private readonly connectionListeners = new Set<ConnectionListener>();
  private readonly resourceList = resources.map((resource) => ({ ...resource }));
  private readonly timers = new Set<number>();
  private transcript = initialTranscript;
  private draft = { revision: 3, text: '' };
  private authenticated = true;

  connectionStatus: ConnectionStatus = 'online';

  async bootstrap(): Promise<BootstrapState> {
    return { authenticated: this.authenticated, deviceName: 'Demo iPhone', catalog };
  }

  async pair(code: string): Promise<BootstrapState> {
    if (!/^\d{8}$/.test(code)) throw new Error('Enter the eight-digit code shown in Emdash.');
    this.authenticated = true;
    return { authenticated: true, deviceName: 'Demo iPhone', catalog };
  }

  async logout(): Promise<void> {
    this.authenticated = false;
  }

  async getResources(taskId: string, category: ResourceCategory): Promise<ResourceSummary[]> {
    return this.resourceList.filter(
      (resource) => resource.taskId === taskId && resourceCategory(resource.kind) === category
    );
  }

  async openResource(resourceId: string): Promise<ResourceHandle> {
    const summary = this.resourceList.find((candidate) => candidate.id === resourceId);
    if (!summary) throw new Error('That resource is no longer available.');
    const base = { handleId: `handle:${summary.id}`, summary: { ...summary } };
    switch (summary.kind) {
      case 'acp':
        return {
          ...base,
          kind: 'acp',
          transcript: this.transcript,
          draft: this.draft,
          isWorking: summary.status === 'working',
          model: 'gpt-5',
          mode: 'default',
          effort: 'high',
          availableModels: [
            { id: 'gpt-5', name: 'GPT-5' },
            { id: 'gpt-5-mini', name: 'GPT-5 mini' },
          ],
          availableModes: [
            { id: 'default', name: 'Default' },
            { id: 'plan', name: 'Plan' },
          ],
          availableEfforts: [
            { id: 'medium', name: 'Medium' },
            { id: 'high', name: 'High' },
          ],
          queue: [],
          terminalOutputs: [],
        };
      case 'agent-terminal':
      case 'terminal':
        return {
          ...base,
          kind: summary.kind,
          snapshot:
            '\u001b[1;32m➜\u001b[0m  mobile-view-510 git:(emdash/mobile-view-510)\n' +
            'pnpm --filter @emdash/emdash-mobile dev\n\n' +
            '\u001b[36mVITE v7.1.11\u001b[0m  ready in 412 ms\n\n' +
            '  ➜  Local:   http://localhost:5173/\n' +
            '  ➜  press h + enter to show help\n',
          cols: 54,
          rows: 22,
          exited: summary.status === 'exited',
          exitCode: summary.status === 'exited' ? 0 : undefined,
        };
      case 'file':
        return {
          ...base,
          kind: 'file',
          path: summary.subtitle ?? summary.title,
          content:
            summary.id === 'file:logo'
              ? undefined
              : `import { useMemo, useState } from 'react';\n\n` +
                `import { useMobileClient } from './client/context';\n` +
                `import { PairScreen } from './components/pair-screen';\n\n` +
                `export function App() {\n` +
                `  const client = useMobileClient();\n` +
                `  const [selection, setSelection] = useState(null);\n\n` +
                `  return (\n` +
                `    <main className="mobile-shell">\n` +
                `      <TaskNavigator onSelect={setSelection} />\n` +
                `    </main>\n` +
                `  );\n` +
                `}\n`,
          language: summary.title.endsWith('.md') ? 'markdown' : 'typescript',
          binary: summary.id === 'file:logo',
          truncated: false,
          size: summary.id === 'file:logo' ? 38_912 : 672,
        };
      case 'diff':
        return {
          ...base,
          kind: 'diff',
          path: `apps/emdash-mobile/src/${summary.title}`,
          staged: summary.subtitle === 'Staged',
          additions: summary.id === 'diff:gateway' ? 187 : 42,
          deletions: summary.id === 'diff:gateway' ? 0 : 8,
          lines: diffLines,
          truncated: false,
        };
      case 'browser':
        return {
          ...base,
          kind: 'browser',
          url: 'http://localhost:4173',
          openable: false,
          warning:
            'This address points to the desktop itself and is not reachable from your phone.',
        };
    }
  }

  async closeResource(_handleId: string): Promise<void> {}

  async getCreateOptions(_taskId: string): Promise<CreateOptions> {
    return {
      agents: [
        {
          id: 'codex',
          name: 'Codex',
          installed: true,
          interfaces: ['acp', 'terminal'],
          models: [
            { id: 'gpt-5', name: 'GPT-5' },
            { id: 'gpt-5-mini', name: 'GPT-5 mini' },
          ],
          supportsAutoApprove: true,
        },
        {
          id: 'claude',
          name: 'Claude Code',
          installed: true,
          interfaces: ['terminal'],
          models: [],
          supportsAutoApprove: true,
        },
      ],
      defaultAgentId: 'codex',
      autoApproveByDefault: true,
      shells: [
        { id: 'zsh', name: 'zsh' },
        { id: 'bash', name: 'bash' },
      ],
      defaultShellId: 'zsh',
    };
  }

  async createResource(request: CreateResourceRequest): Promise<ResourceSummary> {
    const kind = request.kind;
    const summary: ResourceSummary = {
      id: `${kind}:${request.requestId}`,
      taskId: request.taskId,
      kind,
      title:
        kind === 'terminal'
          ? `Terminal ${this.resourceList.filter((item) => item.kind === 'terminal').length + 1}`
          : `Codex ${this.resourceList.filter((item) => item.kind === 'acp').length + 1}`,
      subtitle: kind === 'terminal' ? 'zsh' : kind === 'acp' ? 'Codex · ACP' : 'Codex · TUI',
      status: 'idle',
      badge: kind === 'acp' ? 'ACP' : kind === 'agent-terminal' ? 'TUI' : undefined,
    };
    this.resourceList.unshift(summary);
    this.emit({ type: 'catalog.changed', catalog });
    return summary;
  }

  async renameResource(resourceId: string, title: string): Promise<ResourceSummary> {
    const summary = this.resourceList.find((candidate) => candidate.id === resourceId);
    if (!summary) throw new Error('That resource is no longer available.');
    summary.title = title.trim();
    this.emit({ type: 'resource.renamed', resourceId, title: summary.title });
    return { ...summary };
  }

  async sendPrompt(
    handleId: string,
    input: AcpPromptInput,
    _attachments: PromptAttachment[]
  ): Promise<void> {
    const user = messageTurn(`user:${Date.now()}`, this.transcript.length, 'user', input.text);
    this.transcript = [...this.transcript, user];
    this.emit({ type: 'acp.transcript', handleId, transcript: this.transcript });
    this.emit({ type: 'acp.working', handleId, isWorking: true });
    const timer = window.setTimeout(() => {
      this.timers.delete(timer);
      this.transcript = [
        ...this.transcript,
        messageTurn(
          `agent:${Date.now()}`,
          this.transcript.length,
          'assistant',
          'Got it. I’ll apply that to the active mobile session and keep the desktop view in sync.'
        ),
      ];
      this.emit({ type: 'acp.transcript', handleId, transcript: this.transcript });
      this.emit({ type: 'acp.working', handleId, isWorking: false });
    }, 900);
    this.timers.add(timer);
  }

  async queuePrompt(
    handleId: string,
    input: AcpPromptInput,
    attachments: PromptAttachment[]
  ): Promise<void> {
    await this.sendPrompt(handleId, input, attachments);
  }

  async editQueuedPrompt(
    _handleId: string,
    _promptId: string,
    _input: AcpPromptInput
  ): Promise<void> {}

  async deleteQueuedPrompt(_handleId: string, _promptId: string): Promise<void> {}

  async reorderQueuedPrompts(_handleId: string, _promptIds: string[]): Promise<void> {}

  async exportTranscript(_handleId: string, format: 'parsed' | 'raw'): Promise<TranscriptExport> {
    return {
      name: `demo-${format}.json`,
      mimeType: 'application/json',
      content: JSON.stringify(this.transcript, null, 2),
    };
  }

  async cancelPrompt(handleId: string): Promise<void> {
    this.emit({ type: 'acp.working', handleId, isWorking: false });
  }

  async respondToPermission(
    _handleId: string,
    _requestId: string,
    _optionId: string
  ): Promise<void> {}

  async updateAcpOption(
    _handleId: string,
    _option: 'model' | 'mode' | 'effort',
    _value: string
  ): Promise<void> {}

  async updateDraft(
    handleId: string,
    expectedRevision: number,
    input: AcpPromptInput
  ): Promise<DraftUpdateResult> {
    if (expectedRevision !== this.draft.revision) {
      return { accepted: false, current: this.draft };
    }
    this.draft = { revision: this.draft.revision + 1, ...input };
    this.emit({ type: 'acp.draft', handleId, draft: this.draft });
    return { accepted: true, current: this.draft };
  }

  async sendPtyInput(handleId: string, data: string): Promise<void> {
    this.emit({ type: 'pty.data', handleId, data });
    if (data === '\r')
      this.emit({ type: 'pty.data', handleId, data: '\r\n\u001b[1;32m➜\u001b[0m  ' });
  }

  async resizePty(_handleId: string, _cols: number, _rows: number): Promise<void> {}

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
    this.connectionStatus = 'online';
    for (const listener of this.connectionListeners) listener('online');
  }

  dispose(): void {
    for (const timer of this.timers) window.clearTimeout(timer);
    this.timers.clear();
    this.listeners.clear();
    this.connectionListeners.clear();
  }

  private emit(event: MobileEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

export function demoAcpHandle(): AcpResourceHandle {
  return {
    handleId: 'handle:demo',
    summary: resources[0],
    kind: 'acp',
    transcript: initialTranscript,
    draft: { revision: 0, text: '' },
    isWorking: false,
    availableModels: [],
    availableModes: [],
    availableEfforts: [],
    queue: [],
    terminalOutputs: [],
  };
}
