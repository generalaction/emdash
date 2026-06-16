/**
 * Public API for the @emdash/ui chat module.
 *
 * Import from '@emdash/ui/chat' or use the re-export from the package root.
 */

// ── Data models ──────────────────────────────────────────────────────────────
export type { ChatItem, ChatMessage, ChatRole, ChatToolCall, ToolStatus } from './model';

// ── Block model ───────────────────────────────────────────────────────────────
export type {
  Block,
  BlockId,
  BlockTier,
  CodeBlock,
  InlineCode,
  InlineMention,
  InlineRun,
  InlineText,
  IslandBlock,
  IslandType,
  ProseBlock,
  ProseVariant,
} from './blocks/block-types';
export {
  parseBlocks,
  parseBlocksCached,
  clearBlockCache,
  evictBlockCache,
} from './blocks/parse-blocks';

// ── Measurement ───────────────────────────────────────────────────────────────
export { HeightModel } from './measure/height-model';
export { DEFAULT_FONT_CONFIG } from './measure/fonts';
export type { FontConfig, VariantMetrics } from './measure/fonts';
export { clearPretextCache, registerFontsReadyClear } from './measure/pretext-cache';
export { runParityCheck, logParityCheck } from './measure/parity-check';
export type { ParityResult } from './measure/parity-check';

// ── State ─────────────────────────────────────────────────────────────────────
export { TranscriptStore } from './state/transcript-store';
export { ViewStateStore, useCollapsed } from './state/view-state-store';

// ── View ──────────────────────────────────────────────────────────────────────
export { ChatTranscript } from './view/chat-transcript';
export type { ChatSlots, ChatTranscriptProps } from './view/chat-transcript';

// ── Projected layout engine (imperative renderer) ─────────────────────────────
export { ProjectedTranscript, LayoutStore, ImperativeChat } from './projected/index';
export type {
  ProjectedTranscriptProps,
  ImperativeSlots,
  MountResult,
  MessageLayout,
  BlockLaidOut,
  ProseLaidOut,
  CodeLaidOut,
  IslandLaidOut,
  LineLayout,
  FragmentLayout,
  BulletLayout,
} from './projected/index';
