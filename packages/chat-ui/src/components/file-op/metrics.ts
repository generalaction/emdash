/** File-op row layout constants. */
import { BODY } from '../../core/metrics';

/** Height of the single-line header / inline row: body line-height + 4px top + 4px bottom padding. */
export const FILEOP_ROW_H = BODY.lineHeight + 8;

/** Height of each file row in the expanded list. */
export const FILEOP_LINE_H = BODY.lineHeight;

/** Height of the streaming preview window (visible when running + collapsed). */
export const FILEOP_WINDOW_H = 72;

/** Height of the fade overlay at the top of the preview window. */
export const FILEOP_FADE_H = 24;

/** Top + bottom padding inside the expanded body and preview scroll area. */
export const FILEOP_PAD_Y = 6;
