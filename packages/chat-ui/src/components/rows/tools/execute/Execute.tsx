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

import type { ChatExecute } from '../../../../model';
import { textShimmer } from '../../../../styles/effects.css';
import { sx } from '../../../../styles/sprinkles.css';
import { pexecCmd } from './execute.css';

export type ExecuteProps = {
  item: ChatExecute;
};

export function Execute(props: ExecuteProps) {
  const command = () => props.item.command || '…';

  return (
    <div
      class={sx({
        display: 'flex',
        alignItems: 'center',
        gap: '1.5',
        color: 'fgPassive',
        userSelect: 'none',
        fontSize: 'sm',
      })}
      classList={{ [textShimmer]: props.item.status === 'running' }}
    >
      <span>Execute</span>
      <span
        class={`${pexecCmd} ${sx({ borderRadius: '4', background: 'codeInlineBg' })}`}
        title={props.item.command || undefined}
      >
        {command()}
      </span>
    </div>
  );
}
