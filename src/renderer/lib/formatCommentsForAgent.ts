interface LineComment {
  id: string;
  taskId: string;
  filePath: string;
  lineNumber: number;
  lineContent?: string | null;
  side: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  sentAt?: string | null;
}

// Templates for XML structure
const COMMENT_LINE = (c: LineComment) =>
  `    <comment line="${c.lineNumber}" side="${c.side === 'original' ? 'deleted' : 'current'}">${c.content}</comment>`;

const FILE_BLOCK = (filePath: string, comments: LineComment[]) => `  <file path="${filePath}">
${comments.sort((a, b) => a.lineNumber - b.lineNumber).map(COMMENT_LINE).join('\n')}
  </file>`;

const COMMENTS_WRAPPER = (fileBlocks: string[]) => `The user has left the following comments on the code changes:

<user_comments>
${fileBlocks.join('\n')}
</user_comments>`;

// Group comments by file path
function groupByFile(comments: LineComment[]): Map<string, LineComment[]> {
  const groups = new Map<string, LineComment[]>();
  for (const c of comments) {
    const existing = groups.get(c.filePath) ?? [];
    existing.push(c);
    groups.set(c.filePath, existing);
  }
  return groups;
}

type FormatOptions = {
  includeIntro?: boolean;
};

// Main export
export function formatCommentsForAgent(
  comments: LineComment[],
  { includeIntro = true }: FormatOptions = {}
): string {
  if (!comments.length) return '';

  const byFile = groupByFile(comments);
  const fileBlocks = Array.from(byFile.entries()).map(([filePath, fileComments]) =>
    FILE_BLOCK(filePath, fileComments)
  );

  if (includeIntro) {
    return COMMENTS_WRAPPER(fileBlocks);
  }

  return `\n<user_comments>\n${fileBlocks.join('\n')}\n</user_comments>`;
}
