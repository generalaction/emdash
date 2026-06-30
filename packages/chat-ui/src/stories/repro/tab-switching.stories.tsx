/**
 * Repro: ACP tab-switching crash.
 *
 * Symptoms seen in the desktop when switching between two ACP (Claude) chat tabs:
 *   TypeError: Cannot read properties of undefined (reading 'id')
 *   RangeError: Maximum call stack size exceeded
 *
 * This story replicates the REAL desktop lifecycle and the REAL ACP data shape
 * (verified from apps/emdash-desktop/.emdash-logs/emdash.log), which earlier
 * versions of this story got wrong.
 *
 * Lifecycle (matches desktop):
 *   - One process-wide ChatContext shared across conversations
 *     (getSharedChatContext singleton).
 *   - One ChatState per conversation (AcpChatStore.chatState), kept alive across
 *     tab switches by AcpChatResourceManager's grace period.
 *   - The ChatView is disposed IMMEDIATELY on tab switch: React unmounts the
 *     keyed AcpChatStorePanel, whose ChatTranscript useEffect cleanup calls
 *     view.dispose(). So there is exactly ONE live view per ChatState at a time —
 *     NOT two overlapping views (the previous theory was wrong).
 *   - The grace period preserves the STATE, not the view. So a conversation keeps
 *     streaming into its (view-less) ChatState while you are on another tab, and
 *     a FRESH view mounts onto that still-mutating state when you switch back.
 *
 * Data (matches desktop ACP payloads):
 *   Claude emits a `thinking` update and the following `assistant message` update
 *   with the SAME messageId, e.g. both `msg_01Vy2P9WJkbSNhiN2dB83oxs`
 *   (emdash.log line 147, seq 1 & 2). Through mapAgentUpdate + applyTurnEvent this
 *   produces TWO ChatItems that share one `id` — one `kind:'thinking'` and one
 *   `kind:'message'`. Plans always use the constant id `'plan'`, so repeated plans
 *   across turns also duplicate. chat-ui keys per-row state by item id
 *   (RenderUnit.id = `${itemId}#self` heightmap, findIndexById, scroll anchorId,
 *   collapse map), so these duplicates collide.
 *
 * Use the `sharedMessageId` control to A/B test the hypothesis:
 *   - true  (default): thinking + message share one id (the real ACP shape).
 *   - false: every item gets a unique id (control — should not crash).
 *
 * Usage:
 *   Manual     — click the two tab buttons rapidly to switch.
 *   AutoThrash — switches automatically every switchIntervalMs.
 *   Errors surface in the captured-errors panel above the viewport and in the
 *   browser console. Because Storybook runs chat-ui SOURCE (unminified), the
 *   console stack points at the real file:line.
 */

import { DEFAULT_THEME } from '@core/theme';
import type { ActiveTurnEvent } from '@state/turn-reducer';
import { applyTurnEvent, finalizeTurn } from '@state/turn-reducer';
import { ErrorBoundary, For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { createChatContext } from '@/chat-context';
import type { ChatView } from '@/chat-view';
import { createChatView } from '@/chat-view';
import { generateMockTranscript, mockMentionProvider } from '@/mock-transcript';
import type { ChatItem, ChatMessage, ChatPlanEntry, ChatThinking } from '@/model';
import { createChatState } from '@/state/chat-state';
import { chunkText } from '@/stories/_harness/streaming/scenario';
import { storyViewport } from '@/stories/_harness/chat-host.css';

// ── Representative markdown corpus ─────────────────────────────────────────────
//
// generateMockTranscript is the same realistic markdown corpus the perf/example
// stories use (headings, fenced code, GFM tables, lists, blockquotes, @-mentions,
// inline links). We pull assistant + thinking bodies out of it to use as the
// streamed/seeded message and reasoning text.

const MOCK_CORPUS = generateMockTranscript(160, 7, { richProse: true });

const MARKDOWN_BODIES: string[] = MOCK_CORPUS.filter(
  (it): it is ChatMessage => it.kind === 'message' && it.role === 'assistant'
).map((it) => it.text);

const THINKING_BODIES: string[] = MOCK_CORPUS.filter(
  (it): it is ChatThinking => it.kind === 'thinking'
).map((it) => it.text);

const USER_PROMPTS = [
  'Tell me more about this codebase',
  'Fix the authentication bug in the login flow',
  'Refactor the transcript reconcile path',
  'Why does switching tabs crash the chat?',
];

const TOOL_NAMES = ['search', 'read_file', 'web.run', 'list_files'];
const TOOL_SUMMARIES = [
  'activeTurn reconcile semantics',
  'one-live-view-per-ChatState invariant',
  'https://solidjs.com/docs/latest/reference/store-utilities/reconcile',
  'packages/chat-ui/src/state',
];

const PLAN_ENTRIES: ChatPlanEntry[] = [
  {
    content: 'Reproduce the tab-switching crash in isolation',
    status: 'completed',
    priority: 'high',
  },
  {
    content: 'Inspect real ACP payloads for duplicate item ids',
    status: 'in_progress',
    priority: 'high',
  },
  {
    content: 'Patch the id-keyed structures to tolerate collisions',
    status: 'pending',
    priority: 'medium',
  },
];

function pick<T>(arr: T[], i: number): T {
  return arr[i % arr.length];
}

// ── Turn builder (mirrors the real ACP update stream) ──────────────────────────
//
// One agent turn = thinking -> assistant message (SHARING one messageId when
// sharedMessageId is true) -> tool call -> plan. This is exactly the sequence
// AcpChatStore._replayActiveUpdates folds from mapAgentUpdate output.

function buildAgentTurnEvents(
  convIdx: number,
  seq: number,
  sharedMessageId: boolean
): ActiveTurnEvent[] {
  const tag = `s${convIdx}-t${seq}`;
  // The crux: when sharedMessageId is true, thinking and message use ONE id,
  // exactly like Claude's `msg_…` reuse across a thinking + message update pair.
  const msgId = `${tag}-msg`;
  const thinkId = sharedMessageId ? msgId : `${tag}-think`;
  const toolId = `${tag}-tool`;

  const thinking = pick(THINKING_BODIES, seq) ?? 'Analyzing the request.';
  const body = pick(MARKDOWN_BODIES, seq) ?? 'Done.';

  const events: ActiveTurnEvent[] = [];

  // Reasoning — streamed in deltas (capped so turns cycle quickly).
  events.push({ type: 'thinking_chunk', id: thinkId, text: '', startedAt: Date.now() });
  for (const c of chunkText(thinking, { mode: 'word', size: 6 }).slice(0, 24)) {
    events.push({ type: 'thinking_chunk', id: thinkId, text: c });
  }
  events.push({ type: 'thinking_done', id: thinkId });

  // Assistant message — SAME id as the thinking above when sharedMessageId.
  events.push({ type: 'message_chunk', id: msgId, role: 'assistant', text: '' });
  for (const c of chunkText(body, { mode: 'word', size: 4 }).slice(0, 40)) {
    events.push({ type: 'message_chunk', id: msgId, role: 'assistant', text: c });
  }

  // Tool call.
  events.push({
    type: 'tool_start',
    id: toolId,
    name: pick(TOOL_NAMES, seq),
    inputSummary: pick(TOOL_SUMMARIES, seq),
  });
  events.push({ type: 'tool_update', id: toolId, status: 'done' });

  // Plan — ALWAYS id 'plan', so repeated turns duplicate this id in history.
  events.push({ type: 'plan_update', id: 'plan', entries: PLAN_ENTRIES, streaming: true });

  return events;
}

/** Fold a turn's events into finalized committed items (mirrors foldTurn). */
function foldAgentTurn(convIdx: number, seq: number, sharedMessageId: boolean): ChatItem[] {
  let items: ChatItem[] = [];
  for (const e of buildAgentTurnEvents(convIdx, seq, sharedMessageId)) {
    items = applyTurnEvent(items, e);
  }
  return finalizeTurn(items);
}

/**
 * Seed committed history with several real-shaped turns: a user message followed
 * by an agent turn whose thinking + message share an id. Repeated turns therefore
 * accumulate many duplicate ids (and multiple `'plan'` rows) in committed history.
 */
function makeSeedItems(convIdx: number, turns: number, sharedMessageId: boolean): ChatItem[] {
  const out: ChatItem[] = [];
  for (let t = 0; t < turns; t++) {
    out.push({
      kind: 'message',
      id: `s${convIdx}-u${t}`,
      role: 'user',
      text: pick(USER_PROMPTS, t + convIdx),
    });
    out.push(...foldAgentTurn(convIdx, t, sharedMessageId));
  }
  return out;
}

// ── Harness component ─────────────────────────────────────────────────────────

type HarnessArgs = {
  conversationCount: number;
  switchIntervalMs: number;
  streaming: boolean;
  autoThrash: boolean;
  sharedMessageId: boolean;
};

/**
 * Core story component. Mirrors the desktop ACP lifecycle faithfully:
 *   - One shared ChatContext (getSharedChatContext singleton).
 *   - One ChatState per conversation (AcpChatStore.chatState), persistent.
 *   - Exactly one live ChatView at a time: disposed immediately on switch,
 *     recreated on return (React keyed remount of AcpChatStorePanel).
 *   - Each ChatState keeps streaming even with no view attached (IPC events keep
 *     calling activeTurn.set while the tab is in the background).
 */
function TabSwitchHarness(args: HarnessArgs) {
  const [activeIndex, setActiveIndex] = createSignal(0);
  const [capturedErrors, setCapturedErrors] = createSignal<string[]>([]);

  // Shared process-wide context (theme, caches, measureEpoch, mentions).
  const ctx = createChatContext({ theme: DEFAULT_THEME, mentionProvider: mockMentionProvider });
  onCleanup(() => ctx.dispose());

  // One persistent ChatState per conversation.
  const states = Array.from({ length: args.conversationCount }, (_, i) =>
    createChatState(ctx, { uri: `story-conv-${i}` })
  );
  onCleanup(() => states.forEach((s) => s.dispose()));

  // Seed committed history with the real duplicate-id turn shape.
  states.forEach((state, i) =>
    state.transcript.history.seed(makeSeedItems(i, 6, args.sharedMessageId))
  );

  // ── Detached streaming ───────────────────────────────────────────────────────
  //
  // Every conversation streams continuously regardless of whether a view is
  // attached — exactly like an ACP session whose IPC events keep folding into
  // activeTurn while the user is on another tab. Each tick folds events up to the
  // current step and sets the whole snapshot (matches _replayActiveUpdates), so
  // reconcile() restructures the array as the turn grows.

  if (args.streaming) {
    states.forEach((state, convIdx) => {
      let seq = 0;
      let events = buildAgentTurnEvents(convIdx, seq, args.sharedMessageId);
      let step = 0;

      const intervalId = setInterval(() => {
        let items: ChatItem[] = [];
        for (let i = 0; i <= step && i < events.length; i++) {
          items = applyTurnEvent(items, events[i]);
        }
        state.transcript.activeTurn.set(items, 'generating');

        step++;
        if (step >= events.length) {
          state.transcript.activeTurn.commit('done');
          seq++;
          events = buildAgentTurnEvents(convIdx, seq, args.sharedMessageId);
          step = 0;
        }
      }, 40);

      onCleanup(() => clearInterval(intervalId));
    });
  }

  // ── View manager (single live view) ──────────────────────────────────────────
  //
  // On switch: dispose the current view immediately (React unmount → ChatTranscript
  // cleanup → view.dispose()), then mount a fresh view on the selected state. The
  // selected state may be mid-stream (its activeTurn was mutating while detached),
  // so the fresh view seeds + restores scroll/heightmap over a transcript full of
  // duplicate ids — the exact desktop condition.

  let viewport: HTMLElement | undefined;
  let currentView: ChatView | null = null;

  function mountView(idx: number): void {
    const vp = viewport;
    if (!vp) return;

    // Immediate dispose of the outgoing view (matches the real lifecycle).
    if (currentView !== null) {
      currentView.dispose();
      currentView = null;
    }

    const container = document.createElement('div');
    container.style.cssText = 'position: absolute; inset: 0;';
    vp.replaceChildren(container);

    try {
      currentView = createChatView({
        context: ctx,
        state: states[idx],
        parent: container,
        stickToBottom: true,
        pinUserMessages: true,
        composer: 'none',
      });
    } catch (err: unknown) {
      const name = err instanceof Error ? err.name : 'Error';
      const msg = err instanceof Error ? err.message : String(err);
      setCapturedErrors((prev) => [...prev.slice(-9), `[createChatView] ${name}: ${msg}`]);
      currentView = null;
    }

    setActiveIndex(idx);
  }

  onCleanup(() => currentView?.dispose());

  // ── Error capture ─────────────────────────────────────────────────────────
  //
  // Throws inside chat-ui's Solid root surface as window 'error' events (they are
  // isolated from the outer Solid tree). Capture them so they show in the story.

  onMount(() => {
    const errorHandler = (e: ErrorEvent) => {
      const err = e.error;
      const msg = err instanceof Error ? `${err.name}: ${err.message}` : e.message || String(err);
      if (msg) setCapturedErrors((prev) => [...prev.slice(-9), msg]);
    };
    window.addEventListener('error', errorHandler);
    onCleanup(() => window.removeEventListener('error', errorHandler));

    mountView(0);

    if (args.autoThrash && args.conversationCount >= 2) {
      let flipIdx = 0;
      const thrashId = setInterval(() => {
        flipIdx = (flipIdx + 1) % args.conversationCount;
        mountView(flipIdx);
      }, args.switchIntervalMs);
      onCleanup(() => clearInterval(thrashId));
    }
  });

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        'font-family': 'system-ui, sans-serif',
        display: 'flex',
        'flex-direction': 'column',
        gap: '8px',
      }}
    >
      {/* Tab bar */}
      <div style={{ display: 'flex', gap: '4px', 'align-items': 'center', 'flex-wrap': 'wrap' }}>
        <For each={states}>
          {(_, i) => (
            <button
              onClick={() => mountView(i())}
              style={{
                padding: '4px 12px',
                background: activeIndex() === i() ? '#2563eb' : '#e5e7eb',
                color: activeIndex() === i() ? '#ffffff' : '#111827',
                border: 'none',
                'border-radius': '6px',
                cursor: 'pointer',
                'font-size': '13px',
              }}
            >
              Conversation {i() + 1}
            </button>
          )}
        </For>
        <code style={{ 'font-size': '11px', color: '#9ca3af', 'margin-left': '8px' }}>
          switchMs={args.switchIntervalMs} · streaming={String(args.streaming)} · autoThrash=
          {String(args.autoThrash)} · sharedMessageId={String(args.sharedMessageId)}
        </code>
      </div>

      {/* ErrorBoundary for throws in this Solid tree. */}
      <ErrorBoundary
        fallback={(err, reset) => (
          <div
            style={{
              background: '#fef2f2',
              border: '1px solid #fca5a5',
              padding: '8px 12px',
              'border-radius': '6px',
              display: 'flex',
              gap: '8px',
              'align-items': 'baseline',
            }}
          >
            <strong style={{ color: '#dc2626' }}>ErrorBoundary caught:</strong>
            <code style={{ 'font-size': '11px', color: '#7f1d1d' }}>
              {String((err as Error)?.message ?? err)}
            </code>
            <button
              onClick={reset}
              style={{ padding: '2px 8px', 'border-radius': '4px', 'margin-left': 'auto' }}
            >
              Reset
            </button>
          </div>
        )}
      >
        <Show when={capturedErrors().length > 0}>
          <div
            style={{
              background: '#fef2f2',
              border: '1px solid #fca5a5',
              padding: '8px 12px',
              'border-radius': '6px',
            }}
          >
            <div
              style={{
                display: 'flex',
                'align-items': 'center',
                gap: '8px',
                'margin-bottom': '6px',
              }}
            >
              <strong style={{ color: '#dc2626' }}>
                Errors captured ({capturedErrors().length}):
              </strong>
              <button
                onClick={() => setCapturedErrors([])}
                style={{ padding: '2px 8px', 'border-radius': '4px', 'font-size': '11px' }}
              >
                Clear
              </button>
            </div>
            <For each={capturedErrors()}>
              {(msg) => (
                <div
                  style={{
                    'font-size': '11px',
                    'font-family': 'monospace',
                    color: '#7f1d1d',
                    padding: '2px 0',
                    'white-space': 'pre-wrap',
                  }}
                >
                  {msg}
                </div>
              )}
            </For>
          </div>
        </Show>
      </ErrorBoundary>

      {/* Viewport — chat views are mounted imperatively into this element. */}
      <div
        ref={(el) => {
          viewport = el;
        }}
        class={storyViewport}
        style={{ position: 'relative', width: '880px', height: '540px' }}
      />
    </div>
  );
}

// ── Story wrapper (restart harness on arg changes) ────────────────────────────

function HarnessWrapper(args: HarnessArgs) {
  const restartKey = createMemo(
    () =>
      `${args.conversationCount}|${args.switchIntervalMs}|${String(args.streaming)}|${String(args.autoThrash)}|${String(args.sharedMessageId)}`
  );
  return <For each={[restartKey()]}>{() => <TabSwitchHarness {...args} />}</For>;
}

// ── Meta + exports ────────────────────────────────────────────────────────────

type Args = HarnessArgs;

const meta: Meta<Args> = {
  title: 'Repro/TabSwitching',
  parameters: { layout: 'centered' },
  render: (args) => <HarnessWrapper {...args} />,
  argTypes: {
    conversationCount: {
      control: { type: 'range', min: 2, max: 5, step: 1 },
      description: 'Number of simulated ACP conversations.',
    },
    switchIntervalMs: {
      control: { type: 'range', min: 20, max: 2000, step: 20 },
      description: 'Interval between auto-thrash tab switches (ms).',
    },
    streaming: {
      control: 'boolean',
      description:
        'Keep every conversation streaming (activeTurn reconciling) even while detached.',
    },
    autoThrash: {
      control: 'boolean',
      description: 'Automatically switch between conversations on an interval.',
    },
    sharedMessageId: {
      control: 'boolean',
      description:
        'Real ACP shape: thinking + assistant message share one id (duplicate item ids). ' +
        'Turn OFF to use unique ids as a control.',
    },
  },
  args: {
    conversationCount: 2,
    switchIntervalMs: 80,
    streaming: true,
    autoThrash: false,
    sharedMessageId: true,
  },
};
export default meta;

type Story = StoryObj<Args>;

/**
 * Manual repro — click the two tab buttons rapidly while streaming.
 * Each switch disposes the current view and mounts a fresh one onto a state that
 * is mid-stream and full of duplicate ids (thinking + message sharing an id).
 */
export const Manual: Story = {};

/**
 * Automated repro — switches between conversations every switchIntervalMs.
 * Watch the captured-errors panel and the browser console. Because Storybook
 * runs chat-ui source, any throw points at the real file:line.
 *
 * Toggle `sharedMessageId` off to confirm whether the duplicate id is the trigger.
 */
export const AutoThrash: Story = {
  args: { autoThrash: true },
};
