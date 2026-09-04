/**
 * tool-runs — fold contiguous sibling tool calls into one `tool-group` node.
 *
 * A turn that runs several commands or reads several files in a row is easier
 * to scan as a single "Ran 3 commands, read a file" line than as one row per
 * call. The fold applies to the kinds that render as compact rows; file edits
 * keep their diff cards and subagents already own a group of their own, so
 * both stay outside and terminate a run.
 */

import type { ToolGroup, ToolNode } from '../models/turns/tool-calls';
import type { ToolCallGroupKind, ToolStatus } from '../models/turns/tools';
import { makeToolGroupId } from './ids';

type Groupable = Extract<
  ToolNode,
  {
    kind:
      | 'execute-tool-call'
      | 'read-tool-call'
      | 'search-tool-call'
      | 'mcp-tool-call'
      | 'web-fetch-tool-call'
      | 'unknown-tool-call';
  }
>;

function isGroupable(node: { kind: string }): node is Groupable {
  switch (node.kind) {
    case 'execute-tool-call':
    case 'read-tool-call':
    case 'search-tool-call':
    case 'mcp-tool-call':
    case 'web-fetch-tool-call':
    case 'unknown-tool-call':
      return true;
    default:
      return false;
  }
}

/** Aggregate status of a group: running beats error beats done. */
export function toolRunStatus(children: readonly ToolNode[]): ToolStatus {
  if (children.some((child) => child.status === 'running')) return 'running';
  if (children.some((child) => child.status === 'error')) return 'error';
  return 'done';
}

function phrase(count: number, verb: string, singular: string, plural: string): string {
  return count === 1 ? `${verb} a ${singular}` : `${verb} ${count} ${plural}`;
}

/** Human label for a run, e.g. "Ran 2 commands, read a file, used 3 tools". */
export function toolRunLabel(children: readonly ToolNode[]): string {
  let commands = 0;
  let files = 0;
  let searches = 0;
  let tools = 0;
  for (const child of children) {
    switch (child.kind) {
      case 'execute-tool-call':
        commands += 1;
        break;
      case 'read-tool-call':
        files += 1;
        break;
      case 'search-tool-call':
        searches += 1;
        break;
      default:
        tools += 1;
    }
  }
  const parts: string[] = [];
  if (commands) parts.push(phrase(commands, 'ran', 'command', 'commands'));
  if (files) parts.push(phrase(files, 'read', 'file', 'files'));
  if (searches) parts.push(phrase(searches, 'ran', 'search', 'searches'));
  if (tools) parts.push(phrase(tools, 'used', 'tool', 'tools'));
  const text = parts.join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function groupKindFor(children: readonly ToolNode[]): ToolCallGroupKind {
  return children.every((child) => child.kind === 'read-tool-call') ? 'read-batch' : 'tool-run';
}

/**
 * Wrap every run of two or more contiguous groupable tool nodes in a
 * `tool-group`. Non-tool items and non-groupable tools pass through in place.
 * The group id derives from its first child so it stays stable while the run
 * is still growing.
 */
export function wrapToolRuns<T extends { kind: string; id: string; seq: number }>(
  items: T[]
): Array<T | ToolGroup> {
  const result: Array<T | ToolGroup> = [];
  for (let i = 0; i < items.length; ) {
    const item = items[i];
    if (!isGroupable(item)) {
      result.push(item);
      i += 1;
      continue;
    }

    const run: ToolNode[] = [item];
    let j = i + 1;
    while (j < items.length && isGroupable(items[j])) {
      run.push(items[j] as unknown as ToolNode);
      j += 1;
    }

    if (run.length > 1) {
      result.push({
        kind: 'tool-group',
        id: makeToolGroupId(run[0].id),
        seq: run[0].seq,
        label: toolRunLabel(run),
        groupKind: groupKindFor(run),
        status: toolRunStatus(run),
        children: run,
      });
    } else {
      result.push(item);
    }
    i = j;
  }
  return result;
}
