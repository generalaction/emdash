/**
 * ToolGroup stories — hierarchical tool calls rendered as collapsible composite rows.
 *
 * Each parent tool call wraps its children in a CollapseHeader + PreviewWindow
 * (collapsed) or a full ChildStack (expanded). No visual inset between levels.
 */

import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { ChatHost, ScriptedChat } from '@/stories/_harness/chat-host';
import {
  scenario,
  seedStep,
  streamDiff,
  streamExecute,
  streamTool,
} from '@/stories/_harness/streaming/scenario';

const meta: Meta = {
  title: 'Rows/Tools/ToolGroup',
  component: ChatHost,
  parameters: { layout: 'centered' },
};
export default meta;

type Story = StoryObj<typeof ChatHost>;

// ── Committed (static) stories ────────────────────────────────────────────────

/**
 * A single-level hierarchy: one parent tool call (running) with three children
 * (tool, execute, diff). The parent is collapsed — the preview window shows the
 * children scrolled to the bottom. Click the header to expand.
 */
export const CommittedCollapsed: Story = {
  render: () => (
    <ChatHost
      height={300}
      items={[
        { kind: 'message', id: 'u1', role: 'user', text: 'Refactor the auth module' },
        // Parent tool call
        { kind: 'tool', id: 'p1', name: 'refactor', status: 'done' },
        // Children — reference the parent via parentId
        { kind: 'tool', id: 'c1', name: 'search', status: 'done', parentId: 'p1' },
        {
          kind: 'execute',
          id: 'c2',
          command: 'npx tsc --noEmit',
          status: 'done',
          startedAt: Date.now() - 1200,
          durationMs: 1200,
          parentId: 'p1',
        },
        {
          kind: 'diff',
          id: 'c3',
          path: 'src/auth/token.ts',
          oldText: 'function verify(tok) {',
          newText: 'export function verify(tok: string): boolean {',
          status: 'done',
          parentId: 'p1',
        },
      ]}
    />
  ),
};

/**
 * Same hierarchy in the expanded state.
 * Seeded with the same items as CommittedCollapsed but the parent id is in the
 * initial `viewState` (collapsed = expanded due to inverted semantics).
 * Since stories can't pre-set viewState, click the `refactor` header to expand.
 */
export const CommittedExpanded: Story = {
  render: () => (
    <ChatHost
      height={400}
      items={[
        { kind: 'message', id: 'u1', role: 'user', text: 'Refactor the auth module' },
        { kind: 'tool', id: 'p1', name: 'refactor', status: 'done' },
        { kind: 'tool', id: 'c1', name: 'search', status: 'done', parentId: 'p1' },
        {
          kind: 'execute',
          id: 'c2',
          command: 'npx tsc --noEmit',
          status: 'done',
          startedAt: Date.now() - 1200,
          durationMs: 1200,
          parentId: 'p1',
        },
        {
          kind: 'diff',
          id: 'c3',
          path: 'src/auth/token.ts',
          oldText: 'function verify(tok) {',
          newText: 'export function verify(tok: string): boolean {',
          status: 'done',
          parentId: 'p1',
        },
      ]}
    />
  ),
};

/**
 * Multi-level nesting: a root parent has a child that is itself a parent.
 * No indentation between levels — only the CollapseHeader chrome signals hierarchy.
 */
export const MultiLevel: Story = {
  render: () => (
    <ChatHost
      height={400}
      items={[
        { kind: 'message', id: 'u1', role: 'user', text: 'Run the full pipeline' },
        // Root parent
        { kind: 'tool', id: 'root', name: 'pipeline', status: 'done' },
        // Nested parent (child of root, parent of its own children)
        { kind: 'tool', id: 'sub', name: 'compile', status: 'done', parentId: 'root' },
        // Leaf children of the nested parent
        {
          kind: 'execute',
          id: 'leaf1',
          command: 'tsc',
          status: 'done',
          startedAt: Date.now() - 800,
          durationMs: 800,
          parentId: 'sub',
        },
        {
          kind: 'diff',
          id: 'leaf2',
          path: 'dist/index.js',
          oldText: null,
          newText: '"use strict";\nexports.main = main;',
          status: 'done',
          parentId: 'sub',
        },
        // Another leaf directly under root (not part of the nested parent)
        { kind: 'tool', id: 'leaf3', name: 'lint', status: 'done', parentId: 'root' },
      ]}
    />
  ),
};

// ── Streaming story ───────────────────────────────────────────────────────────

/**
 * Active streaming: a parent tool starts running, then children stream in one
 * by one. The preview window auto-scrolls to the newest child while the parent
 * is still active. A final commit settles the turn and shows the collapsed summary.
 *
 * Click the parent header to expand and see the full child stack.
 */
export const Streaming: Story = {
  render: () => (
    <ScriptedChat
      height={350}
      script={scenario(
        [
          seedStep([
            { kind: 'message', id: 'u1', role: 'user', text: 'Analyse and fix the repository' },
          ]),
        ],
        // Parent starts running
        streamTool({
          id: 'p1',
          name: 'analyse_and_fix',
          steps: [],
        }),
        // Child 1: a search tool
        streamTool({
          id: 'c1',
          name: 'search',
          inputSummary: 'TypeScript strict-mode errors',
          parentId: 'p1',
          steps: [{ afterMs: 700, status: 'done' }],
        }),
        // Child 2: an execute step
        streamExecute({
          id: 'c2',
          command: 'npx tsc --noEmit 2>&1 | head -20',
          durationMs: 900,
          parentId: 'p1',
        }),
        // Child 3: a diff
        streamDiff({
          id: 'c3',
          path: 'src/auth/token.ts',
          oldText: 'function verify(tok) {\n  return tok !== null;\n}',
          newText:
            'export function verify(tok: string): boolean {\n  return tok.length > 0;\n}\n',
          headerMs: 400,
          chunkMs: 100,
          parentId: 'p1',
          finalStatus: 'done',
        }),
        // Child 4: another search
        streamTool({
          id: 'c4',
          name: 'search',
          inputSummary: 'remaining lint warnings',
          parentId: 'p1',
          steps: [{ afterMs: 600, status: 'done' }],
        }),
        // Settle the parent and commit the turn
        [
          {
            kind: 'call' as const,
            fn: (api) => {
              api.activeTurn.set(
                (api.activeTurn.get() ?? []).map((it) =>
                  it.id === 'p1' ? { ...it, status: 'done' } : it
                ),
                'generating'
              );
            },
          },
          { kind: 'wait' as const, ms: 300 },
          {
            kind: 'call' as const,
            fn: (api) => api.activeTurn.commit('done'),
          },
        ]
      )}
    />
  ),
};
