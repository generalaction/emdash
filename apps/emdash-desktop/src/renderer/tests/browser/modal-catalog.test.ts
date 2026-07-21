import type { Result } from '@emdash/shared';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { openModal } from '@core/manifests/browser/modal-api';
import { modalCatalog } from '@core/manifests/browser/modal-catalog';
import type { ModalDismissed } from '@core/primitives/modals/react';

vi.mock('@renderer/lib/stores/app-state', () => ({ appState: {}, sidebarStore: {} }));

const expectedModalIds = [
  'addProjectModal',
  'addRemoteModal',
  'addSshConnModal',
  'agentSignInModal',
  'changeProjectConnectionModal',
  'commandPaletteModal',
  'confirmActionModal',
  'confirmExternalLinkModal',
  'conflictDialog',
  'createConversationModal',
  'createPrModal',
  'createSkillModal',
  'deleteTaskModal',
  'feedbackModal',
  'githubConnectModal',
  'githubDeviceFlowModal',
  'integrationSetupModal',
  'projectConfigImportModal',
  'promptModal',
  'quitUnsavedChangesModal',
  'renameTaskModal',
  'shareProjectConfigModal',
  'taskModal',
  'unsavedChangesModal',
] as const;

function openUnsavedChangesForTypeTest() {
  return openModal('unsavedChangesModal', {
    fileName: 'README.md',
  });
}

describe('modalCatalog', () => {
  it('contains every modal exactly once', () => {
    const catalogIds = modalCatalog.defs.map((definition) => definition.id).sort();

    expect(catalogIds).toEqual([...expectedModalIds].sort());
  });

  it('infers caller props and outcomes from modal ids', () => {
    expectTypeOf<ReturnType<typeof openUnsavedChangesForTypeTest>>().toEqualTypeOf<
      Promise<Result<'save' | 'discard', ModalDismissed>>
    >();
  });
});
