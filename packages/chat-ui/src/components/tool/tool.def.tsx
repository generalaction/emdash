/**
 * toolUnitDef — native UnitDef for ChatToolCall rows.
 *
 * Fixed height of ROW_H. No collapse state.
 */

import { ROW_H } from '../../core/metrics';
import { defineUnit } from '../../core/units';
import type { ChatToolCall } from '../../model';
import { Tool } from './Tool';

export const toolUnitDef = defineUnit<ChatToolCall>({
  kind: 'tool',

  measure(): number {
    return ROW_H;
  },

  Render(props) {
    return (
      <div class="border-chat-border flex items-center" style={{ height: `${ROW_H}px` }}>
        <Tool item={props.data} />
      </div>
    );
  },
});
