/**
 * Execute — SolidJS component for ChatExecute rows.
 *
 * Renders ACP `kind: 'execute'` tool calls as a single non-interactive row:
 *
 *   Execute  `{command}`  {elapsed}s
 *
 * - Command is shown as a truncated inline-code chip (max 150px, mirrors Prose
 *   inline code styling). Full command is exposed via the title attribute.
 * - Shimmer on the whole row while running.
 * - Live ticking elapsed counter while running; frozen duration when done.
 *   Duration is omitted entirely when not running and durationMs is absent.
 *
 * Geometry lives in execute.module.css. Visual styling uses Tailwind.
 */

import type { ChatExecute } from '../../model';
import styles from './execute.module.css';

export type ExecuteProps = {
  item: ChatExecute;
};

export function Execute(props: ExecuteProps) {

  const command = () => props.item.command || '…';

  return (
    <div
      class={`${styles.pexec} flex items-center gap-1.5 text-sm text-foreground-passive select-none`}
      classList={{ 'text-shimmer': props.item.status === 'running' }}
    >
      <span>Execute</span>
      <span
        class={`${styles['pexec__cmd']} rounded bg-[var(--chat-code-inline-bg,rgba(0,0,0,0.06))]`}
        title={props.item.command || undefined}
      >
        {command()}
      </span>
    </div>
  );
}
