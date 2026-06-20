/**
 * Plan — presentational components for ChatPlan rows.
 *
 * PlanHeader: collapsible header using the CollapseHeader primitive.
 *   Shows "Plan {done} out of {total} Tasks done" with a shimmer while the plan
 *   is streaming or any entry is in_progress.
 *   Uses data-collapse-id for ChatRoot click-delegation (toggle handled for free).
 *
 * PlanList: expanded body rendering each entry as a status-icon gutter +
 *   measured block stack. Each entry's pre-measured Measured<StackLayout> is
 *   rendered through <Project>{renderBlockLeaf}</Project> so prose wraps exactly
 *   at the geometry computed by measure().
 *
 * Status icons (14x14 SVG, centered in a 20px line-height box):
 *   pending → dotted circle / in_progress → spinner ring + center dot /
 *   completed → circle with check.
 * Priority tints: high → amber, medium → default, low → muted.
 */

import { Match, Switch, For } from 'solid-js';
import type { ChatPlan, PlanEntryPriority, PlanEntryStatus } from '../../model';
import { BlockStackView } from '../primitives/BlockStackView';
import { PlanCompletedIcon, PlanInProgressIcon, PlanPendingIcon } from '../primitives/icons';
import type { PlanEntryLaid } from './plan.def';

// ── PlanHeader ────────────────────────────────────────────────────────────────

export type PlanHeaderProps = {
  item: ChatPlan;
  expanded: boolean;
  rowH: number;
};

export function PlanHeader(props: PlanHeaderProps) {
  const total = () => props.item.entries.length;
  const done = () => props.item.entries.filter((e) => e.status === 'completed').length;
  const active = () =>
    !!props.item.streaming || props.item.entries.some((e) => e.status === 'in_progress');

  return (
    <div
      class="hover:bg-chat-bg-3 border-chat-border text-chat-fg-muted flex cursor-pointer items-center gap-1.5 border-b px-2 text-sm transition-colors select-none"
      style={{ height: `${props.rowH}px` }}
      role="button"
      aria-expanded={props.expanded ? 'true' : 'false'}
      data-collapse-id={props.item.id}
    >
      <span classList={{ 'text-shimmer': active() }}>
        Plan {done()} out of {total()} Tasks done
      </span>
      <span
        class="inline-block text-[10px] transition-transform duration-150 ease-out"
        classList={{ 'rotate-90': props.expanded }}
        aria-hidden="true"
      >
        ›
      </span>
    </div>
  );
}

// ── Status glyph helpers ──────────────────────────────────────────────────────

function statusColor(status: PlanEntryStatus): string {
  if (status === 'completed') return 'var(--chat-plan-done, #22c55e)';
  if (status === 'in_progress') return 'var(--chat-plan-active, #f59e0b)';
  return 'var(--chat-fg-passive, currentColor)';
}

function priorityOpacity(priority: PlanEntryPriority): string {
  if (priority === 'low') return '0.55';
  return '1';
}

// ── PlanList ──────────────────────────────────────────────────────────────────

export type PlanListProps = {
  entries: PlanEntryLaid[];
  padY: number;
  entryGap: number;
  /** Width (px) of the status-icon box. */
  iconBox: number;
  /** Horizontal gap (px) between the status icon and the entry text. */
  iconGap: number;
};

export function PlanList(props: PlanListProps) {
  return (
    <div
      style={{
        'padding-top': `${props.padY}px`,
        'padding-bottom': `${props.padY}px`,
      }}
    >
      <For each={props.entries}>
        {(entry, i) => (
          <div
            style={{
              display: 'flex',
              'align-items': 'flex-start',
              'column-gap': `${props.iconGap}px`,
              'margin-top': i() > 0 ? `${props.entryGap}px` : '0',
              opacity: priorityOpacity(entry.priority),
            }}
          >
            {/* Status icon gutter: 14x14 icon centered in a 20px (line-height) box. */}
            <div
              style={{
                width: `${props.iconBox}px`,
                height: '20px',
                'flex-shrink': '0',
                display: 'flex',
                'align-items': 'center',
                'justify-content': 'center',
                color: statusColor(entry.status),
                'user-select': 'none',
              }}
              aria-label={entry.status.replace('_', ' ')}
            >
              <Switch>
                <Match when={entry.status === 'completed'}>
                  <PlanCompletedIcon />
                </Match>
                <Match when={entry.status === 'in_progress'}>
                  <PlanInProgressIcon />
                </Match>
                <Match when={entry.status === 'pending'}>
                  <PlanPendingIcon />
                </Match>
              </Switch>
            </div>
            {/* Entry body: measured block stack */}
            <div style={{ flex: '1' }}>
              <BlockStackView node={entry.measured} />
            </div>
          </div>
        )}
      </For>
    </div>
  );
}
