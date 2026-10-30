import { z } from 'zod';
import type { DraftCommentTarget } from '@core/primitives/line-comments/api';

export const MAX_AI_ANNOTATIONS = 100;
export const MAX_AI_ANNOTATION_BODY_LENGTH = 4000;
const LINE_SEARCH_RADIUS = 3;

const BLOCK_PATTERN = /<emdash-annotations>([\s\S]*?)<\/emdash-annotations>/g;

// Agent replies are untrusted: every field is validated and bounded before it reaches the UI.
const annotationSchema = z.object({
  path: z.string().min(1).max(4096),
  line: z.number().int().positive(),
  // Required: without it an explanation cannot be re-anchored or hidden when its line changes.
  lineContent: z.string().max(10_000),
  body: z.string().trim().min(1),
});

export type ParsedAiAnnotation = {
  path: string;
  lineNumber: number;
  lineContent: string;
  body: string;
};

function describeDiff(target: DraftCommentTarget): string {
  switch (target.kind) {
    case 'working-tree':
      return target.group === 'staged'
        ? `the staged changes (\`git diff --cached -- ${target.path}\`)`
        : `the unstaged working-tree changes (\`git diff -- ${target.path}\`)`;
    case 'pr':
      return `pull request #${target.prNumber} (\`git diff ${target.baseOid}...${target.headOid} -- ${target.path}\`)`;
    case 'commit':
      return target.originalSha
        ? `the change between commits (\`git diff ${target.originalSha} ${target.modifiedSha} -- ${target.path}\`)`
        : `the root commit (\`git show ${target.modifiedSha} -- ${target.path}\`)`;
  }
}

export function buildExplainPrompt(target: DraftCommentTarget): {
  text: string;
  hiddenContext: string;
} {
  return {
    text: `Explain the changes in \`${target.path}\``,
    hiddenContext: `Explain ${describeDiff(target)} in \`${target.path}\` so a reviewer can understand them. Do not modify any files.
If that command prints nothing (for example, the file is untracked), read the file and treat all of it as new.
Anchor each explanation to a line on the new (modified) side of the diff. End your reply with exactly one block in this format:
<emdash-annotations>
[{"path": "${target.path}", "line": <modified-side line number>, "lineContent": "<exact text of that line>", "body": "<plain-text explanation>"}]
</emdash-annotations>
Use at most ${MAX_AI_ANNOTATIONS} entries and keep each body under ${MAX_AI_ANNOTATION_BODY_LENGTH} characters.`,
  };
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** Extracts validated annotations from the last `<emdash-annotations>` block in an agent reply. */
export function parseAiAnnotations(
  reply: string,
  allowedPaths: ReadonlySet<string>
): ParsedAiAnnotation[] {
  const block = Array.from(reply.matchAll(BLOCK_PATTERN)).at(-1)?.[1];
  if (block === undefined) return [];

  const json = block
    .trim()
    .replace(/^```(?:json)?\s*/, '')
    .replace(/\s*```$/, '');
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];

  const annotations: ParsedAiAnnotation[] = [];
  for (const item of raw) {
    if (annotations.length >= MAX_AI_ANNOTATIONS) break;
    const parsed = annotationSchema.safeParse(item);
    if (!parsed.success) continue;
    const path = parsed.data.path.replace(/^\.\//, '');
    if (!allowedPaths.has(path)) continue;
    annotations.push({
      path,
      lineNumber: parsed.data.line,
      lineContent: parsed.data.lineContent,
      body: truncate(parsed.data.body, MAX_AI_ANNOTATION_BODY_LENGTH),
    });
  }
  return annotations;
}

/**
 * Returns the current line an annotation belongs to, or null when the anchored line no longer
 * exists. Tolerates small line-number drift by matching `lineContent` nearby.
 */
export function resolveAnnotationLine(
  annotation: Pick<ParsedAiAnnotation, 'lineNumber' | 'lineContent'>,
  lineCount: number,
  getLineContent: (lineNumber: number) => string
): number | null {
  const { lineNumber, lineContent } = annotation;
  const expected = lineContent.trim();
  for (let distance = 0; distance <= LINE_SEARCH_RADIUS; distance++) {
    const candidates =
      distance === 0 ? [lineNumber] : [lineNumber - distance, lineNumber + distance];
    for (const candidate of candidates) {
      if (candidate < 1 || candidate > lineCount) continue;
      if (getLineContent(candidate).trim() === expected) return candidate;
    }
  }
  return null;
}
