import type { ContractClient } from '@emdash/wire/api';
import type { HostDependencyResolver } from '@primitives/host-dependencies/api';
import type { HostDependencyResolverContract } from '@services/host-dependencies/api';

export function createHostDependencyResolverFromDependency(
  client: ContractClient<HostDependencyResolverContract>
): HostDependencyResolver {
  return {
    async resolve(id) {
      return client.resolve({ id });
    },
  };
}
