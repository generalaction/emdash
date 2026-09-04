import type { ToolNode } from '@/model';

/** Actionable and exceptional state that a collapsed tool header must preserve. */
export type ToolHeaderState = {
  active: boolean;
  awaitingPermission: boolean;
  error: boolean;
  errorTitle?: string;
};

const SETTLED_STATE: ToolHeaderState = {
  active: false,
  awaitingPermission: false,
  error: false,
};

/**
 * Combine one tool node with the already-derived state of its children.
 *
 * A synthetic `tool-group` contributes no state of its own: its status is
 * already a lossy aggregate (running beats error) and has no tool-call id for
 * permission lookup. Its descendants remain the source of truth.
 */
export function deriveToolHeaderState(
  node: ToolNode,
  childStates: readonly ToolHeaderState[],
  pendingToolCallIds: ReadonlySet<string>
): ToolHeaderState {
  const ownState =
    node.kind === 'tool-group'
      ? SETTLED_STATE
      : {
          active: node.status === 'running' && !pendingToolCallIds.has(node.toolCallId),
          awaitingPermission: pendingToolCallIds.has(node.toolCallId),
          error: node.status === 'error',
        };
  const active = ownState.active || childStates.some((state) => state.active);
  const awaitingPermission =
    ownState.awaitingPermission || childStates.some((state) => state.awaitingPermission);
  const error = ownState.error || childStates.some((state) => state.error);
  const childErrorTitle = childStates.find((state) => state.errorTitle)?.errorTitle;

  return {
    active,
    awaitingPermission,
    error,
    ...(error ? { errorTitle: childErrorTitle ?? 'A tool in this group failed' } : {}),
  };
}
