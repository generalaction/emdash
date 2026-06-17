/**
 * chatCssVars — single source of all --chat-* CSS custom properties.
 *
 * Assembled from each component spec's cssVars() function plus shared
 * layout constants.  ChatRoot writes these on the transcript root element
 * so every var(--chat-*) resolves consistently across all renderers.
 *
 * Typography (font size/weight/family) is now sourced directly from
 * @emdash/ui --type-* role tokens in prose.module.css and code.module.css.
 * Only geometry-coupled and component-specific custom properties remain here.
 *
 * To change any visual constant: edit the relevant component's metrics.ts.
 * The change will propagate here (CSS vars) and to the layout arithmetic
 * (geometry) automatically.
 */

import { codeSpec } from './components/code/spec';
import { execCssVars } from './components/execute/css-vars';
import { fileOpCssVars } from './components/file-op/css-vars';
import { islandSpec } from './components/island/spec';
import { messageCssVars } from './components/message/css-vars';
import { proseSpec } from './components/prose/spec';
import { tableSpec } from './components/table/spec';
import { thinkingCssVars } from './components/thinking/css-vars';
import { toolCssVars } from './components/tool/spec';
import { MENTION_EXTRA_WIDTH, ROW_GAP, ROW_INSET_X } from './core/metrics';

export function chatCssVars(): Record<string, string> {
  return {
    '--chat-mention-pad-x': `${MENTION_EXTRA_WIDTH / 2}px`,
    '--chat-row-gap': `${ROW_GAP}px`,
    '--chat-msg-pad-x': `${ROW_INSET_X}px`,
    ...proseSpec.cssVars(),
    ...codeSpec.cssVars(),
    ...islandSpec.cssVars(),
    ...tableSpec.cssVars(),
    ...messageCssVars(),
    ...toolCssVars(),
    ...thinkingCssVars(),
    ...fileOpCssVars(),
    ...execCssVars(),
  };
}
