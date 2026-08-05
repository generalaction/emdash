import { defineContract, fallible, liveModel, liveState } from '@emdash/wire';
import { z } from 'zod';
import { createWorkspaceErrorSchema, deleteWorkspaceErrorSchema } from './errors';
import {
  createWorkspaceInputSchema,
  deleteWorkspaceInputSchema,
  workspaceRecordSchema,
  workspaceRecordsSchema,
} from './schemas';

/**
 * The host workspace registry (ADR 0005): a durable, sole-writer index of registered
 * paths plus host-computed observations. The filesystem stays the source of truth — the
 * registry observes it and never converges the world toward a record. Lifecycle verbs
 * are plain fail-fast RPCs; no outbox, no durable operations, no job objects. Progress
 * and current state are read from `records`, which merges durable rows with the
 * in-memory runtime overlay.
 */
export const workspaceRegistryContract = defineContract({
  /**
   * Sole read path. Full map on subscribe; durable records merged with the in-memory
   * runtime overlay; republished on every registry mutation, overlay change, and scan
   * result. Desktops apply every delivery as a full snapshot.
   */
  records: liveModel({
    key: z.void().optional(),
    states: {
      list: liveState({ data: workspaceRecordsSchema }),
    },
  }),

  /**
   * Register an existing path. Kind is host-detected; registering a worktree of an
   * unregistered repository auto-registers the parent (adopted). Replay: same id + same
   * path is a no-op success; a different path under the same id is an
   * immutable-field-mismatch; the same path under a different id returns
   * already-registered carrying the existing record.
   */
  createWorkspace: fallible({
    input: createWorkspaceInputSchema,
    data: workspaceRecordSchema,
    error: createWorkspaceErrorSchema,
  }),

  /**
   * Deactivate-if-active + unregister. Never touches disk, valid on every kind.
   * Idempotent: an absent id succeeds.
   */
  deleteWorkspace: fallible({
    input: deleteWorkspaceInputSchema,
    data: z.void(),
    error: deleteWorkspaceErrorSchema,
  }),
});

export type WorkspaceRegistryContract = typeof workspaceRegistryContract;
