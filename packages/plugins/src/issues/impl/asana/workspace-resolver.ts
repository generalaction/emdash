import { err, ok, type Result } from '@emdash/shared';
import { toIntegrationError } from '../../../integrations/helpers/error';
import type {
  AsanaClient,
  AsanaResponse,
  AsanaUser,
  AsanaWorkspace,
} from '../../../integrations/impl/asana/types';
import type { IntegrationError } from '../../../integrations/types';

export async function resolveAsanaWorkspace(
  client: AsanaClient
): Promise<Result<AsanaWorkspace, IntegrationError>> {
  try {
    const response = (await client.users.getUser('me', {
      opt_fields: 'gid,name,workspaces.gid,workspaces.name',
    })) as AsanaResponse<AsanaUser>;

    const workspaceGid = response.data?.workspaces?.[0]?.gid;
    if (!workspaceGid) {
      return err({
        type: 'generic',
        message: 'No Asana workspace available for this account.',
      });
    }
    return ok({ gid: workspaceGid });
  } catch (error) {
    return err(toIntegrationError(error, 'Asana'));
  }
}
