import type { Provenance } from '@core/primitives/project-settings/api';

export type ProviderAccountReportingState =
  | { kind: 'disabled'; message: string }
  | { kind: 'connect'; message: string }
  | { kind: 'silent' }
  | { kind: 'unresolvable'; message: string };

export function providerAccountReportingState(
  providerName: string,
  provenance: Provenance,
  accountsConnected: boolean
): ProviderAccountReportingState {
  switch (provenance.kind) {
    case 'set':
      return { kind: 'disabled', message: `${providerName} is disabled for this project.` };
    case 'unresolvable':
    case 'broken-setting':
      return {
        kind: 'unresolvable',
        message: `The selected ${providerName} account is no longer connected.`,
      };
    case 'inferred':
      return accountsConnected
        ? { kind: 'silent' }
        : { kind: 'connect', message: `Connect a ${providerName} account to get started.` };
  }
}
