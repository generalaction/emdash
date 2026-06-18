/**
 * Plan — presentational components for ChatPlan rows.
 *
 * PlanHeader: collapsible header using the CollapseHeader primitive.
 *   Shows "Plan {done} out of {total} Tasks done" with a shimmer while the plan
 *   is streaming or any entry is in_progress.
 *   Uses data-collapse-id for ChatRoot click-delegation (toggle handled for free).
 *
 * PlanList: expanded body rendering each entry as a status-glyph gutter +
 *   measured block stack. Each entry's pre-measured Measured<StackLayout> is
 *   rendered through <Project>{renderBlockLeaf}</Project> so prose wraps exactly
 *   at the geometry computed by measure().
 *
 * Status glyphs: ○ pending / ◐ in_progress / ● completed.
 * Priority tints: high → amber, medium → default, low → muted.
 */

import { For } from 'solid-js';
import type { ChatPlan, PlanEntryPriority, PlanEntryStatus } from '../../model';
import { CollapseHeader } from '../primitives/CollapseHeader';
import { Project, renderBlockLeaf } from '../Project';
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
    <CollapseHeader
      id={props.item.id}
      expanded={props.expanded}
      active={active()}
      height={props.rowH}
    >
      Plan {done()} out of {total()} Tasks done
    </CollapseHeader>
  );
}

// ── Status glyph helpers ──────────────────────────────────────────────────────

const STATUS_GLYPH: Record<PlanEntryStatus, string> = {
  pending: '○',
  in_progress: '◐',
  completed: '●',
};

function statusColor(status: PlanEntryStatus): string {
  if (status === 'completed') return 'var(--chat-plan-done, #22c55e)';
  if (status === 'in_progress') return 'var(--chat-plan-active, #f59e0b)';
  return 'var(--foreground-passive, currentColor)';
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
  indent: number;
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
              'margin-top': i() > 0 ? `${props.entryGap}px` : '0',
              opacity: priorityOpacity(entry.priority),
            }}
          >
            {/* Status glyph gutter */}
            <div
              style={{
                width: `${props.indent}px`,
                'flex-shrink': '0',
                'padding-top': '2px',
                'font-size': '10px',
                'line-height': '1',
                color: statusColor(entry.status),
                'user-select': 'none',
              }}
              aria-label={entry.status.replace('_', ' ')}
            >
              {STATUS_GLYPH[entry.status]}
            </div>
            {/* Entry body: measured block stack */}
            <div
              style={{
                position: 'relative',
                flex: '1',
                height: `${entry.measured.height}px`,
              }}
            >
              <Project node={entry.measured}>{renderBlockLeaf}</Project>
            </div>
          </div>
        )}
      </For>
    </div>
  );
}
