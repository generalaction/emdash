import type { ChatCommands } from '@core/features/conversations/api/browser/chat/chat-transcript';
// TODO(conversations-extraction): Inject task editor/file-opening behavior into ACP chat.
import { openFileInAdjacentPane } from '@core/features/editor/api/browser/open-file-in-file-editor';

const EXPLICIT_SCHEME_RE = /^[A-Za-z][A-Za-z\d+.-]*:/u;
const EDITOR_LOCATION_SUFFIX_RE = /(?::\d+(?::\d+)?|#L\d+(?:C\d+)?)$/u;
const BASENAME_WITH_LINE_SUFFIX_RE = /^[^/\\:]+\.[^/\\:]+:\d+(?::\d+)?$/u;
const WINDOWS_ABSOLUTE_PATH_RE = /^[A-Za-z]:[\\/]/u;
const WINDOWS_UNC_PATH_RE = /^\\\\[^\\]+\\[^\\]+/u;

type TranscriptLinkClassification = ReturnType<NonNullable<ChatCommands['classifyLink']>>;

type TranscriptFileContext = {
  projectId: string;
  taskId: string;
};

type TranscriptFileOpener = (projectId: string, taskId: string, filePath: string) => Promise<void>;

export type TranscriptFileCommands = {
  classifyLink: NonNullable<ChatCommands['classifyLink']>;
  onOpenFile: NonNullable<ChatCommands['onOpenFile']>;
  openMentionFile: (filePath: string) => void;
};

/**
 * Classifies markdown links at the Emdash host boundary. A scheme-less href is
 * a file path in a desktop agent transcript; explicit URI schemes, anchors,
 * query-only links, and protocol-relative URLs keep browser behavior. Editor
 * location suffixes are removed because the file opener accepts paths, not
 * line/column annotations.
 */
export function classifyTranscriptLink(href: string): TranscriptLinkClassification {
  const target = href.trim();
  if (!target || target.startsWith('#') || target.startsWith('?') || target.startsWith('//')) {
    return { kind: 'external' };
  }
  const filePath = target.replace(EDITOR_LOCATION_SUFFIX_RE, '');
  if (
    target.startsWith('/') ||
    WINDOWS_ABSOLUTE_PATH_RE.test(target) ||
    WINDOWS_UNC_PATH_RE.test(target) ||
    BASENAME_WITH_LINE_SUFFIX_RE.test(target)
  ) {
    return { kind: 'workspace-file', path: filePath };
  }
  if (EXPLICIT_SCHEME_RE.test(target)) return { kind: 'external' };
  return { kind: 'workspace-file', path: filePath };
}

/** All file affordances originating in chat preserve the transcript and open to its right. */
export function createTranscriptFileCommands(
  context: TranscriptFileContext,
  openFile: TranscriptFileOpener = openFileInAdjacentPane
): TranscriptFileCommands {
  const open = (filePath: string) => {
    void openFile(context.projectId, context.taskId, filePath);
  };

  return {
    classifyLink: classifyTranscriptLink,
    onOpenFile: ({ path }) => open(path),
    openMentionFile: open,
  };
}
