export {
  canonicalExclusionPatterns,
  DEFAULT_SEARCH_EXCLUDE,
  DEFAULT_TREE_EXCLUDE,
  DEFAULT_WATCHER_EXCLUDE,
  ExclusionPolicy,
  normalizeExclusionPatterns,
  type ExclusionMatcher,
  type ExclusionPolicyOptions,
} from './exclusion-policy';

export type Observed<T> = {
  value: T;
  observedAt: number;
  source: 'probe' | 'operation-result' | 'log-event';
};
