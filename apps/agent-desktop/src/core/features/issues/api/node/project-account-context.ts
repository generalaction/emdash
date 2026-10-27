import type { IssueAccountUnavailableError } from '@core/primitives/issue-providers/api';
import type { Resolved } from '@core/primitives/project-settings/api';

/**
 * The §7 reporting matrix over a project account resolution (spec:
 * github-git-settings §7, shared by every issue provider): explicit none and
 * dangling pins fail closed with an `account_unavailable` payload carrying
 * the provenance; a resolved account passes through. The inferred-absent case
 * is returned as `inferred-none` because providers diverge there — GitHub
 * infers per repository host downstream, single-host integrations report
 * not-connected.
 */
export type ProjectAccountContext<A> =
  | { kind: 'account'; account: A }
  | { kind: 'inferred-none' }
  | { kind: 'unavailable'; error: IssueAccountUnavailableError };

export function classifyProjectAccountResolution<A>(
  resolution: Resolved<A | null>,
  options: {
    accountsConnected: boolean;
    disabledMessage: string;
    unresolvableMessage: string;
  }
): ProjectAccountContext<A> {
  if (resolution.value !== null) {
    return { kind: 'account', account: resolution.value };
  }
  if (resolution.provenance.kind === 'set') {
    return {
      kind: 'unavailable',
      error: {
        type: 'account_unavailable',
        provenance: resolution.provenance,
        accountsConnected: options.accountsConnected,
        message: options.disabledMessage,
      },
    };
  }
  if (resolution.provenance.kind === 'unresolvable') {
    return {
      kind: 'unavailable',
      error: {
        type: 'account_unavailable',
        provenance: resolution.provenance,
        accountsConnected: options.accountsConnected,
        message: options.unresolvableMessage,
      },
    };
  }
  return { kind: 'inferred-none' };
}
