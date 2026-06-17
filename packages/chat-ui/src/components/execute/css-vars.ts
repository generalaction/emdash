/**
 * execCssVars — exposes the execute row height as a CSS custom property.
 */

import { EXEC_ROW_H } from './metrics';

export function execCssVars(): Record<string, string> {
  return {
    '--chat-exec-row-h': `${EXEC_ROW_H}px`,
  };
}
