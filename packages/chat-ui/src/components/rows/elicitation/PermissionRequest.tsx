/**
 * PermissionRequest — elicitation row for agent permission requests.
 *
 * Renders a bordered box:
 *   "Requesting permission to {title}"        [ Allow once ▾ ]
 *
 * The split button's primary face fires onResolveElicitation with the
 * currently-selected option; the chevron opens a portaled menu to switch.
 * The host is expected to dispatch `elicitation_removed` on resolve so the
 * row disappears optimistically (no ACP ack exists).
 */

import { useCommands } from '@components/contexts/CommandsContext';
import type { ChatElicitation } from '@/model';
import { SplitButton } from './SplitButton';
import { elicitationBox, elicitationLabel, elicitationTitle } from './elicitation.css';

export type PermissionRequestProps = {
  item: ChatElicitation;
};

export function PermissionRequest(props: PermissionRequestProps) {
  const commands = useCommands();

  const handleResolve = (optionId: string) => {
    commands().onResolveElicitation?.({
      elicitationId: props.item.id,
      optionId,
      itemId: props.item.id,
    });
  };

  return (
    <div class={elicitationBox}>
      <div class={elicitationLabel}>
        <span class={elicitationTitle} title={`Requesting permission to ${props.item.title}`}>
          Requesting permission to {props.item.title}
        </span>
      </div>
      <SplitButton item={props.item} onResolve={handleResolve} />
    </div>
  );
}
