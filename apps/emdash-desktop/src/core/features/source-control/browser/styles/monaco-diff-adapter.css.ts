import { hostAdapter } from '@emdash/ui/styles/host';

/**
 * Rooted integration overrides for Monaco-owned DOM inside one source-control diff view.
 * Imperative class names used by the comment manager remain private to this adapter.
 */
export const monacoDiffAdapterClassName = hostAdapter({
  root: {},
  descendants: {
    '& .monaco-editor .margin': {
      backgroundColor: 'transparent',
    },
    '& .monaco-editor .glyph-margin > div': {
      border: 'none',
      outline: 'none',
      boxShadow: 'none',
    },
    '& .monaco-editor .view-zones': {
      pointerEvents: 'auto',
    },
    '& .monaco-editor .view-zone': {
      pointerEvents: 'auto',
    },
    '& .comment-view-zone': {
      pointerEvents: 'auto',
    },
  },
});
