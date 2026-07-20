import type { ResolveRepositoryDestinationParams } from '@core/primitives/projects/api';
import { workspacePlacementResolver } from '@main/core/workspaces/placement/workspace-placement-resolver';

export async function resolveRepositoryDestination(input: ResolveRepositoryDestinationParams) {
  return workspacePlacementResolver.resolveRepositoryDestination(
    input.host,
    input.name,
    input.chosenDir
  );
}
