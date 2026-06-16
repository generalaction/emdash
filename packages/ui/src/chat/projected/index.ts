/**
 * Public API for the projected layout + imperative rendering engine.
 */

export { ProjectedTranscript } from './view/projected-transcript';
export type { ProjectedTranscriptProps } from './view/projected-transcript';

export { ImperativeChat } from './engine/imperative-chat';

export { LayoutStore } from './layout/layout-store';

export type { ImperativeSlots, MountResult } from './slots';

export type {
  BlockLaidOut,
  BulletLayout,
  CodeLaidOut,
  FragmentLayout,
  IslandLaidOut,
  LineLayout,
  MessageLayout,
  ProseLaidOut,
} from './layout/layout-types';
