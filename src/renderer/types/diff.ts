/**
 * Diff-related types used across the renderer.
 */

export type DiffLine = {
  left?: string;
  right?: string;
  type: 'context' | 'add' | 'del';
};
