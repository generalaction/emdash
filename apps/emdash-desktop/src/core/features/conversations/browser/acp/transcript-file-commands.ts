import type { ChatCommands } from '@core/features/conversations/api/browser/chat/chat-transcript';
// TODO(conversations-extraction): Inject task editor/file-opening behavior into ACP chat.
import { openFileInAdjacentPane } from '@core/features/editor/api/browser/open-file-in-file-editor';

const EXPLICIT_SCHEME_RE = /^[A-Za-z][A-Za-z\d+.-]*:/u;
const EDITOR_LOCATION_SUFFIX_RE = /(?::(\d+)(?::\d+)?|#L(\d+)(?:C\d+)?)$/u;
const BASENAME_WITH_LINE_SUFFIX_RE = /^[^/\\:]+\.[^/\\:]+:\d+(?::\d+)?$/u;
const WINDOWS_ABSOLUTE_PATH_RE = /^[A-Za-z]:[\\/]/u;
const WINDOWS_UNC_PATH_RE = /^\\\\[^\\]+\\[^\\]+/u;

type TranscriptLinkClassification = ReturnType<NonNullable<ChatCommands['classifyLink']>>;

type TranscriptFileContext = {
  projectId: string;
  taskId: string;
};

type TranscriptFileOpener = (
  projectId: string,
  taskId: string,
  filePath: string,
  options?: { line?: number }
) => Promise<void>;

export type TranscriptFileCommands = {
  classifyLink: NonNullable<ChatCommands['classifyLink']>;
  onOpenFile: NonNullable<ChatCommands['onOpenFile']>;
  openMentionFile: (filePath: string) => void;
};

/**
 * Classifies markdown links at the Emdash host boundary. A scheme-less href is
 * a file path in a desktop agent transcript; explicit URI schemes, anchors,
 * query-only links, and protocol-relative URLs keep browser behavior. Editor
 * location suffixes are removed from paths and their line is passed to the
 * editor. The file opener does not accept a column.
 */
export function classifyTranscriptLink(href: string): TranscriptLinkClassification {
  const target = href.trim();
  if (!target || target.startsWith('#') || target.startsWith('?') || target.startsWith('//')) {
    return { kind: 'external' };
  }
  const locationSuffix = EDITOR_LOCATION_SUFFIX_RE.exec(target);
  const filePath = locationSuffix ? target.slice(0, -locationSuffix[0].length) : target;
  const parsedLine = locationSuffix ? Number(locationSuffix[1] ?? locationSuffix[2]) : undefined;
  const fileLink = {
    kind: 'workspace-file' as const,
    path: filePath,
    ...(parsedLine !== undefined && Number.isSafeInteger(parsedLine) && parsedLine > 0
      ? { line: parsedLine }
      : {}),
  };
  if (
    target.startsWith('/') ||
    WINDOWS_ABSOLUTE_PATH_RE.test(target) ||
    WINDOWS_UNC_PATH_RE.test(target) ||
    BASENAME_WITH_LINE_SUFFIX_RE.test(target)
  ) {
    return fileLink;
  }
  if (EXPLICIT_SCHEME_RE.test(target)) return { kind: 'external' };
  return fileLink;
}

/** All file affordances originating in chat preserve the transcript and open to its right. */
export function createTranscriptFileCommands(
  context: TranscriptFileContext,
  openFile: TranscriptFileOpener = openFileInAdjacentPane
): TranscriptFileCommands {
  const open = (filePath: string, line?: number) => {
    if (line === undefined) {
      void openFile(context.projectId, context.taskId, filePath);
      return;
    }
    void openFile(context.projectId, context.taskId, filePath, { line });
  };

  return {
    classifyLink: classifyTranscriptLink,
    onOpenFile: ({ path, line }) => open(path, line),
    openMentionFile: open,
  };
}
