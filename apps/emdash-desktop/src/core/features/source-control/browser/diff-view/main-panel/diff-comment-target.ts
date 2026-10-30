import type { GitObjectRef } from '@emdash/core/runtimes/git/api';
import { gitRefToString, HEAD_REF } from '@core/primitives/git/api';
import type { DraftCommentTarget } from '@core/primitives/line-comments/api';
import type { DiffTabResource } from '../stores/diff-tab-resource';

function refShaOrString(ref: GitObjectRef | undefined): string {
  if (!ref) return gitRefToString(HEAD_REF);
  return ref.kind === 'commit' ? ref.sha : gitRefToString(ref);
}

export function diffTabToCommentTarget(tab: DiffTabResource): DraftCommentTarget {
  if (tab.diffGroup === 'disk' || tab.diffGroup === 'staged') {
    return { kind: 'working-tree', group: tab.diffGroup, path: tab.path };
  }

  if (tab.diffGroup === 'pr') {
    return {
      kind: 'pr',
      prNumber: tab.prNumber ?? 0,
      baseOid: tab.prBaseOid ?? refShaOrString(tab.originalRef),
      headOid: tab.prHeadOid ?? refShaOrString(tab.modifiedRef),
      path: tab.path,
    };
  }

  return {
    kind: 'commit',
    originalSha:
      tab.commitOriginalSha !== undefined ? tab.commitOriginalSha : refShaOrString(tab.originalRef),
    modifiedSha: tab.commitModifiedSha ?? refShaOrString(tab.modifiedRef),
    path: tab.path,
  };
}
