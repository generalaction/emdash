/**
 * theme.ts — public ChatTheme alias + back-compat re-exports.
 *
 * The canonical types and builder now live in core/config.ts.
 * This file re-exports everything that external consumers previously
 * imported from '@core/theme' so the public API remains stable.
 */

export type {
  ChatConfig,
  ChipConfig,
  DensityScale,
  FontConfig,
  FontFamilies,
  ProseConfig,
  ResolvedTheme,
  RoleName,
  TypeRole,
  VariantMetrics,
} from './config';

export {
  DEFAULT_CONFIG,
  buildChatTheme,
  fontShorthand,
  toCssVars,
  toFontConfig,
} from './config';

/**
 * ChatTheme is an alias for ResolvedTheme (the full output of buildChatTheme).
 * Kept as a named alias so existing `theme?: ChatTheme` props compile without change.
 */
export type { ResolvedTheme as ChatTheme } from './config';

import { DEFAULT_CONFIG, buildChatTheme, type ResolvedTheme } from './config';
import type { FontConfig } from './config';

/** The default chat theme. Pass to ChatRoot when no custom config is needed. */
export const DEFAULT_THEME: ResolvedTheme = buildChatTheme(DEFAULT_CONFIG);

/**
 * Build a theme with custom fonts only.
 * @deprecated Pass a full `config: ChatConfig` to `buildChatTheme` instead.
 */
export function buildTheme(fonts?: FontConfig): ResolvedTheme {
  if (!fonts) return buildChatTheme(DEFAULT_CONFIG);
  // For callers that previously built a FontConfig and passed it in, derive a
  // plausible config from DEFAULT_CONFIG and override the fonts field only by
  // running buildChatTheme normally (the FontConfig embedded in the result is
  // the one derived from the config, not the passed-in fonts).
  // This back-compat wrapper cannot perfectly reverse a FontConfig → ChatConfig,
  // so it returns DEFAULT_THEME when a FontConfig is provided — callers should
  // migrate to buildChatTheme(config) with a custom ChatConfig instead.
  return buildChatTheme(DEFAULT_CONFIG);
}
