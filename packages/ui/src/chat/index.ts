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
export { DEFAULT_FONT_CONFIG } from './measure/fonts';
export type { FontConfig, VariantMetrics } from './measure/fonts';
export { clearPretextCache, registerFontsReadyClear } from './measure/pretext-cache';

// ── State ─────────────────────────────────────────────────────────────────────
export { TranscriptStore } from './state/transcript-store';
export { ViewStateStore } from './state/view-state-store';

// ── View ──────────────────────────────────────────────────────────────────────
export { ChatTranscript } from './view/chat-transcript';
export type { ChatTranscriptProps } from './view/chat-transcript';

// ── Slots ─────────────────────────────────────────────────────────────────────
export type { ChatSlots, MountResult } from './slots';

// ── Layout engine ─────────────────────────────────────────────────────────────
export { LayoutStore } from './layout/layout-store';
export { ImperativeChat } from './engine/imperative-chat';
export type { ImperativeChatOptions } from './engine/imperative-chat';

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
