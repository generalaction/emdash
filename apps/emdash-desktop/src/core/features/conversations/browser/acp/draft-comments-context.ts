import { formatCommentsForAgent, type LineCommentLike } from '@core/primitives/line-comments/api';

export async function appendDraftCommentsContext(
  hiddenContext: Promise<string | undefined>,
  comments: readonly LineCommentLike[]
): Promise<string | undefined> {
  const base = await hiddenContext;
  if (comments.length === 0) return base;
  const formatted = formatCommentsForAgent([...comments], { includeIntro: true });
  return base ? `${base}\n\n${formatted}` : formatted;
}
