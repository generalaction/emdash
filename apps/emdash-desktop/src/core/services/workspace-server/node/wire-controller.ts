import { createController, type Controller } from '@emdash/wire/api';
import { workspaceServerDesktopContract } from '../api';
import type { WorkspaceServerProvisioningModel } from './provision/provisioning-model';

export function createWorkspaceServerWireController(
  model: WorkspaceServerProvisioningModel
): Controller {
  return createController(workspaceServerDesktopContract, {
    provisioning: model.host,
  });
}
