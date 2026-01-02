export type LineCommentLike = {
  filePath: string;
  lineNumber: number;
  content: string;
};

type FormatOptions = {
  includeIntro?: boolean;
  leadingNewline?: boolean;
};

const COMMENT_LINE = (c: LineCommentLike) => {
  return `    <comment line="${c.lineNumber}">${c.content}</comment>`;
};

const FILE_BLOCK = (filePath: string, comments: LineCommentLike[]) => `  <file path="${filePath}">
${comments.sort((a, b) => a.lineNumber - b.lineNumber).map(COMMENT_LINE).join('\n')}
  </file>`;

const COMMENTS_WRAPPER = (fileBlocks: string[]) => `The user has left the following comments on the code changes:

<user_comments>
${fileBlocks.join('\n')}
</user_comments>`;

function groupByFile(comments: LineCommentLike[]): Map<string, LineCommentLike[]> {
  const groups = new Map<string, LineCommentLike[]>();
  for (const c of comments) {
    const existing = groups.get(c.filePath) ?? [];
    existing.push(c);
    groups.set(c.filePath, existing);
  }
  return groups;
}

export function formatCommentsForAgent(
  comments: LineCommentLike[],
  { includeIntro = false, leadingNewline = false }: FormatOptions = {}
): string {
  if (!comments.length) return '';

  const byFile = groupByFile(comments);
  const fileBlocks = Array.from(byFile.entries()).map(([filePath, fileComments]) =>
    FILE_BLOCK(filePath, fileComments)
  );
  const prefix = leadingNewline ? '\n' : '';

  if (includeIntro) {
    return `${prefix}${COMMENTS_WRAPPER(fileBlocks)}`;
  }

  return `${prefix}<user_comments>\n${fileBlocks.join('\n')}\n</user_comments>`;
}
