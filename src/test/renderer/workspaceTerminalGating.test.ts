import { describe, it, expect } from 'vitest';

/**
 * Tests the workspace terminal gating logic used in RightSidebar.
 *
 * Bug: TaskTerminalPanel rendered TerminalPane immediately, even when the
 * workspace connection hadn't resolved yet. This caused the terminal to
 * start a local session instead of connecting to the remote workspace.
 *
 * Fix: Compute `awaitingRemote = isWorkspaceTask && !wsConnectionId` and
 * pass it to TaskTerminalPanel, which shows a loading state instead of
 * rendering terminals.
 */

/** Mirrors the computation in RightSidebar.tsx */
function computeAwaitingRemote(
  taskMetadata: { workspace?: unknown } | null | undefined,
  wsConnectionId: string | null
): boolean {
  const isWorkspaceTask = !!taskMetadata?.workspace;
  return isWorkspaceTask && !wsConnectionId;
}

/** Mirrors the effectiveConnectionId computation in RightSidebar.tsx */
function computeEffectiveConnectionId(
  wsConnectionId: string | null,
  projectRemoteConnectionId: string | null
): string | null {
  return wsConnectionId || projectRemoteConnectionId || null;
}

describe('workspace terminal gating', () => {
  describe('awaitingRemote computation', () => {
    it('returns false for non-workspace tasks (no metadata)', () => {
      expect(computeAwaitingRemote(null, null)).toBe(false);
    });

    it('returns false for non-workspace tasks (no workspace key)', () => {
      expect(computeAwaitingRemote({}, null)).toBe(false);
    });

    it('returns true when task has workspace but connection not yet resolved', () => {
      expect(
        computeAwaitingRemote({ workspace: { provisionCommand: './provision.sh' } }, null)
      ).toBe(true);
    });

    it('returns false when workspace connection is resolved', () => {
      expect(
        computeAwaitingRemote(
          { workspace: { provisionCommand: './provision.sh' } },
          'workspace-conn-123'
        )
      ).toBe(false);
    });
  });

  describe('effectiveConnectionId computation', () => {
    it('prefers workspace connection over project connection', () => {
      expect(computeEffectiveConnectionId('ws-conn-1', 'proj-conn-1')).toBe('ws-conn-1');
    });

    it('falls back to project connection when workspace is null', () => {
      expect(computeEffectiveConnectionId(null, 'proj-conn-1')).toBe('proj-conn-1');
    });

    it('returns null when neither connection is available', () => {
      expect(computeEffectiveConnectionId(null, null)).toBe(null);
    });
  });

  describe('terminal rendering decision', () => {
    /** Mirrors the logic in TaskTerminalPanel: when awaitingRemote, don't render terminals */
    function shouldRenderTerminals(awaitingRemote: boolean): boolean {
      return !awaitingRemote;
    }

    it('renders terminals for non-workspace tasks', () => {
      const awaiting = computeAwaitingRemote(null, null);
      expect(shouldRenderTerminals(awaiting)).toBe(true);
    });

    it('does NOT render terminals while workspace connection is pending', () => {
      const awaiting = computeAwaitingRemote({ workspace: { provisionCommand: './p.sh' } }, null);
      expect(shouldRenderTerminals(awaiting)).toBe(false);
    });

    it('renders terminals once workspace connection resolves', () => {
      const awaiting = computeAwaitingRemote(
        { workspace: { provisionCommand: './p.sh' } },
        'workspace-conn-abc'
      );
      expect(shouldRenderTerminals(awaiting)).toBe(true);
    });
  });
});
