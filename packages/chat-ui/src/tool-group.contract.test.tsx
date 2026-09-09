import { afterEach, describe, expect, it } from 'vitest';
import { createChatContext } from '@/chat-context';
import { createChatView } from '@/chat-view';
import type { AcpPermissionRequest, ToolNode, ToolStatus, TranscriptTurn } from '@/model';
import { createChatState } from '@/state/chat-state';
import { textShimmer } from '@styles/effects.css';

const nextPaint = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function execute(id: string, status: ToolStatus): Extract<ToolNode, { toolCallId: string }> {
  return {
    kind: 'execute-tool-call',
    id,
    seq: 0,
    toolCallId: id,
    title: id,
    command: id,
    status,
  };
}

function permissionFor(toolCall: Extract<ToolNode, { toolCallId: string }>): AcpPermissionRequest {
  return {
    requestId: `request-${toolCall.toolCallId}`,
    toolCall,
    options: [
      { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
      { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
    ],
  };
}

async function mountGroup(children: ToolNode[], permissions: AcpPermissionRequest[] = []) {
  const context = createChatContext();
  const state = createChatState(context);
  const group: Extract<ToolNode, { kind: 'tool-group' }> = {
    kind: 'tool-group',
    id: 'group',
    seq: 0,
    label: 'Tool run',
    groupKind: 'tool-run',
    status: children.some((child) => child.status === 'running')
      ? 'running'
      : children.some((child) => child.status === 'error')
        ? 'error'
        : 'done',
    children,
  };
  const turn: TranscriptTurn = {
    id: 'turn-1',
    seq: 0,
    initiator: 'agent',
    items: [group],
  };
  state.session.setPermissions(permissions);
  state.transcript.history.seed([turn]);

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;top:0;left:0;width:800px;height:300px;';
  document.body.appendChild(host);
  const view = createChatView({ context, state, parent: host });

  cleanups.push(() => {
    view.dispose();
    state.dispose();
    context.dispose();
    host.remove();
  });

  await nextPaint();
  const header = host.querySelector<HTMLElement>('[data-collapse-id="group"]');
  if (!header) throw new Error('Tool group header did not render');
  const label = header.firstElementChild;
  if (!(label instanceof HTMLElement)) throw new Error('Tool group label did not render');
  return { header, label };
}

describe('tool-group status contract', () => {
  it('shows permission without shimmering when all running work is blocked', async () => {
    const blocked = execute('blocked', 'running');
    const { header, label } = await mountGroup(
      [execute('done', 'done'), blocked],
      [permissionFor(blocked)]
    );

    expect(header.querySelector('[aria-label="awaiting permission"]')).not.toBeNull();
    expect(label.classList.contains(textShimmer)).toBe(false);
  });

  it('shows both permission and activity when another child is running', async () => {
    const blocked = execute('blocked', 'running');
    const { header, label } = await mountGroup(
      [execute('active', 'running'), blocked],
      [permissionFor(blocked)]
    );

    expect(header.querySelector('[aria-label="awaiting permission"]')).not.toBeNull();
    expect(label.classList.contains(textShimmer)).toBe(true);
  });

  it('shows a completed child failure on the collapsed header', async () => {
    const { header } = await mountGroup([execute('failed', 'error'), execute('done', 'done')]);

    expect(header.querySelector('[aria-label="error"]')).not.toBeNull();
  });

  it('shows both failure and activity while another child is running', async () => {
    const { header, label } = await mountGroup([
      execute('failed', 'error'),
      execute('active', 'running'),
    ]);

    expect(header.querySelector('[aria-label="error"]')).not.toBeNull();
    expect(label.classList.contains(textShimmer)).toBe(true);
  });
});
