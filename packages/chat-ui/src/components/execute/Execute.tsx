/**
 * Execute — SolidJS component for ChatExecute rows.
 *
 * Renders ACP `kind: 'execute'` tool calls as a single non-interactive row:
 *
 *   Execute  `{command}`
 *
 * - Command is shown as a truncated inline-code chip (max 150px, mirrors Prose
 *   inline code styling). Full command is exposed via the title attribute.
 * - Shimmer on the whole row while running.
 *
 * Outer geometry (height, horizontal padding) is applied by execute.def.ts Render.
 * This component only describes inner content; no height/padding CSS needed here.
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
      class="flex items-center gap-1.5 text-sm text-foreground-passive select-none"
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
