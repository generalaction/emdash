/**
 * FileOperation — slot components for ChatFileOpToolCall rows.
 *
 * FileOpRow         — single-file inline row ('file-op:row' slot).
 * FileOpHeader      — multi-file collapsible header ('file-op:header' slot).
 * FileOpList        — expanded per-file list ('file-op:list' slot).
 * FileOpPreviewBody — streaming per-file list body ('file-op:preview' slot,
 *                     wrapped in ProjectWindow by fileOpDef's compose tree).
 *
 * Constants (FILEOP_PAD_Y, FILEOP_WINDOW_H) live in file-op.def.tsx and are
 * imported here to keep geometry in a single place.
 *
 * Collapse semantics are inverted (same as Thinking):
 *   stored false (default) → not expanded
 *   stored true            → expanded
 */

import { For, Show, createEffect } from 'solid-js';
import type { ChatFileOpToolCall, FileOpKind } from '../../model';
import { basename } from '../../lib/path';
import { useCommands } from '../CommandsContext';
import { CollapseHeader } from '../primitives/CollapseHeader';

// ── Verb map ──────────────────────────────────────────────────────────────────

const VERB: Record<FileOpKind, string> = {
  read: 'Read',
  edit: 'Edited',
  delete: 'Deleted',
  move: 'Moved',
};

// ── Internal: FileRowItem ─────────────────────────────────────────────────────

function FileRowItem(props: {
  verb: string;
  path: string;
  lineH: number;
  onClick?: () => void;
}) {
  return (
    <div
      class="flex items-center gap-1.5 text-sm text-foreground-passive"
      classList={{ 'cursor-pointer hover:text-foreground-muted': !!props.onClick }}
      style={{ height: `${props.lineH}px` }}
      role={props.onClick ? 'button' : undefined}
      onClick={props.onClick}
    >
      <span>{props.verb}</span>
      <span title={props.path}>{basename(props.path)}</span>
    </div>
  );
}

// ── FileOpRow (single-file) ───────────────────────────────────────────────────

export type FileOpRowProps = {
  item: ChatFileOpToolCall;
  rowH: number;
  lineH: number;
};

export function FileOpRow(props: FileOpRowProps) {
  const commands = useCommands();
  const verb = () => VERB[props.item.op];

  const openFile = (path: string) => {
    commands().onOpenFile?.({ path, itemId: props.item.id, source: 'file-op' });
  };

  return (
    <div class="flex items-center" style={{ height: `${props.rowH}px` }}>
      <Show
        when={props.item.ops[0]}
        fallback={
          <span
            class="font-mono text-sm text-foreground-passive"
            classList={{ 'text-shimmer': props.item.status === 'running' }}
          >
            {verb()}…
          </span>
        }
      >
        {(op) => (
          <FileRowItem
            verb={verb()}
            path={op().path}
            lineH={props.lineH}
            onClick={() => openFile(op().path)}
          />
        )}
      </Show>
    </div>
  );
}

// ── FileOpHeader (multi-file header) ─────────────────────────────────────────

export type FileOpHeaderProps = {
  item: ChatFileOpToolCall;
  expanded: boolean;
  rowH: number;
};

export function FileOpHeader(props: FileOpHeaderProps) {
  return (
    <CollapseHeader
      id={props.item.id}
      expanded={props.expanded}
      active={props.item.status === 'running'}
      height={props.rowH}
    >
      {VERB[props.item.op]} {props.item.ops.length} files
    </CollapseHeader>
  );
}

// ── FileOpList (expanded per-file list) ───────────────────────────────────────

export type FileOpListProps = {
  item: ChatFileOpToolCall;
  lineH: number;
  padY: number;
};

export function FileOpList(props: FileOpListProps) {
  const commands = useCommands();
  const verb = () => VERB[props.item.op];

  const openFile = (path: string) => {
    commands().onOpenFile?.({ path, itemId: props.item.id, source: 'file-op' });
  };

  return (
    <div style={{ 'padding-block': `${props.padY}px` }}>
      <For each={props.item.ops}>
        {(op) => (
          <FileRowItem
            verb={verb()}
            path={op.path}
            lineH={props.lineH}
            onClick={() => openFile(op.path)}
          />
        )}
      </For>
    </div>
  );
}

// ── FileOpPreviewBody (streaming ops body inside ProjectWindow) ───────────────

export type FileOpPreviewBodyProps = {
  item: ChatFileOpToolCall;
  lineH: number;
  padY: number;
};

/**
 * Renders the ops list for the active-preview state.
 * ProjectWindow (from the compose tree) handles the overflow container and fade
 * overlay. Auto-scroll is driven by item.ops.length since the slot height is
 * fixed (FILEOP_WINDOW_H) and ProjectWindow's child.height never changes.
 */
export function FileOpPreviewBody(props: FileOpPreviewBodyProps) {
  const verb = () => VERB[props.item.op];
  let innerEl: HTMLDivElement | undefined;

  createEffect(() => {
    const _n = props.item.ops.length; // reactive tracking
    if (innerEl) innerEl.scrollTop = innerEl.scrollHeight;
    return _n;
  });

  return (
    <div
      ref={(el) => {
        innerEl = el;
      }}
      style={{ height: '100%', 'overflow-y': 'auto', 'scrollbar-gutter': 'stable' }}
    >
      <div style={{ 'padding-block': `${props.padY}px` }}>
        <For each={props.item.ops}>
          {(op) => <FileRowItem verb={verb()} path={op.path} lineH={props.lineH} />}
        </For>
      </div>
    </div>
  );
}

// ── FileOperation (legacy component kept for open-file contract test) ──────────

/**
 * @deprecated Use fileOpDef.Render via Project instead.
 * Kept so open-file.contract.test.tsx can test click-delegation without
 * mounting the full Row pipeline.
 */
export type FileOperationProps = {
  item: ChatFileOpToolCall;
  /** Inverted semantics: stored "collapsed" bool means "expanded". */
  collapsed?: boolean;
};

export function FileOperation(props: FileOperationProps) {
  const commands = useCommands();
  const verb = () => VERB[props.item.op];
  const expanded = () => !!props.collapsed;

  const openFile = (path: string) => {
    commands().onOpenFile?.({ path, itemId: props.item.id, source: 'file-op' });
  };

  return (
    <Show
      when={props.item.ops.length > 1}
      fallback={
        <Show
          when={props.item.ops[0]}
          fallback={
            <span
              class="font-mono text-sm text-foreground-passive"
              classList={{ 'text-shimmer': props.item.status === 'running' }}
            >
              {verb()}…
            </span>
          }
        >
          {(op) => (
            <FileRowItem
              verb={verb()}
              path={op().path}
              lineH={16}
              onClick={() => openFile(op().path)}
            />
          )}
        </Show>
      }
    >
      <div>
        <div
          class="flex cursor-pointer items-center gap-1.5 text-sm text-foreground-passive select-none hover:text-foreground-muted"
          role="button"
          aria-expanded={expanded() ? 'true' : 'false'}
          data-collapse-id={props.item.id}
        >
          <span classList={{ 'text-shimmer': props.item.status === 'running' }}>
            {verb()} {props.item.ops.length} files
          </span>
          <span
            class="inline-block text-[10px] transition-transform duration-150 ease-out"
            classList={{ 'rotate-90': expanded() }}
            aria-hidden="true"
          >
            ›
          </span>
        </div>
        <Show when={expanded()}>
          <For each={props.item.ops}>
            {(op) => (
              <FileRowItem
                verb={verb()}
                path={op.path}
                lineH={16}
                onClick={() => openFile(op.path)}
              />
            )}
          </For>
        </Show>
      </div>
    </Show>
  );
}
