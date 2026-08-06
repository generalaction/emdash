import {
  workspaceCreationAdmissionContract,
  type WorkspaceCreationRefusal,
} from '@emdash/core/runtimes/automations/api';
import { err, ok, type Result } from '@emdash/shared';
import { createController, type Controller } from '@emdash/wire/rpc';
import { findWorkspaceTombstoneConflict } from '@core/features/workspaces/api/node/registry/workspace-tombstones';
import type { AppDb } from '@core/services/app-db/node/db';

/**
 * Tombstone-aware creation admission for local automation runs (ADR 0006, spec §4):
 * the same branch + path data check task creation performs, exposed to the automations
 * runtime worker as a component dependency. Deletion tombstones live on the desktop
 * workspace mirror, which the worker cannot read itself. The desktop's automations
 * runtime provisions on the local host only — remote projects resolve to their host's
 * own runtime — so the check targets local placement.
 */
export function checkLocalWorktreeCreationAdmission(
  db: AppDb,
  input: { path: string; branch: string }
): Result<void, WorkspaceCreationRefusal> {
  const conflict = findWorkspaceTombstoneConflict(db, {
    kind: 'placement',
    location: 'local',
    sshConnectionId: null,
    path: input.path,
    branch: input.branch,
  });
  return conflict ? err(conflict) : ok(undefined);
}

/** Wire controller handed to the automations worker; resolves the db lazily per call. */
export function createAutomationCreationAdmissionController(getDb: () => AppDb): Controller {
  return createController(workspaceCreationAdmissionContract, {
    checkWorktreeCreation: async (input) => checkLocalWorktreeCreationAdmission(getDb(), input),
  });
}
