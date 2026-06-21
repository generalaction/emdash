import { BlockStackView } from '@components/primitives/BlockStackView';
import {
  PlanCompletedIcon,
  PlanInProgressIcon,
  PlanPendingIcon,
} from '@components/primitives/icons';
import { Match, Switch, For } from 'solid-js';
import type { ChatPlan, PlanEntryPriority, PlanEntryStatus } from '@/model';
import type { PlanEntryLaid } from './plan.def';
import { chevron, planHeader, textShimmer } from './plan.css';
import { planVars } from './plan.css';

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
      class={planHeader}
      style={{ height: `${props.rowH}px` }}
      role="button"
      aria-expanded={props.expanded ? 'true' : 'false'}
      data-collapse-id={props.item.id}
    >
      <span classList={{ [textShimmer]: active() }}>
        Plan {done()} out of {total()} Tasks done
      </span>
      <span class={chevron({ expanded: props.expanded })} aria-hidden="true">
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
};

export function PlanList(props: PlanListProps) {
  return (
    <div
      style={{
        'padding-top': planVars.padY,
        'padding-bottom': planVars.padY,
      }}
    >
      <For each={props.entries}>
        {(entry, i) => (
          <div
            style={{
              display: 'flex',
              'align-items': 'flex-start',
              'column-gap': planVars.iconGap,
              'margin-top': i() > 0 ? planVars.entryGap : '0',
              opacity: priorityOpacity(entry.priority),
            }}
          >
            <div
              style={{
                width: planVars.iconBox,
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
            <div style={{ flex: '1' }}>
              <BlockStackView node={entry.measured} />
            </div>
          </div>
        )}
      </For>
    </div>
  );
}
