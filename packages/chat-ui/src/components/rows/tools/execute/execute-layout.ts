/**
 * execute-layout — pure display decisions for the execute row.
 *
 * Kept free of DOM and SolidJS so the collapsed/expanded geometry rules can be
 * unit-tested in the node project and shared by measure() and Render.
 */

import type { ChatExecute } from '@/model';

export type ExecuteHeaderTitle = {
  text: string;
  /** True when the title is the command itself and should be set in code font. */
  mono: boolean;
};

/**
 * Whether the card body (command + output) is visible.
 *
 * Only when the user expands the row. Running rows stay a single header line
 * too (the shimmer shows activity) so nothing pops open and closes on its own
 * while an agent works through several commands.
 */
export function executeShowsBody(_item: ChatExecute, isExpanded: boolean): boolean {
  return isExpanded;
}

/**
 * Header label: the provider description when present, otherwise the first
 * line of the command so a collapsed row still says what ran.
 */
export function executeHeaderTitle(item: ChatExecute): ExecuteHeaderTitle {
  const summary = item.inputSummary?.trim();
  if (summary) return { text: summary, mono: false };
  const firstLine = item.command.split('\n')[0]?.trim() ?? '';
  if (firstLine) return { text: firstLine, mono: true };
  return { text: 'Execute', mono: false };
}
