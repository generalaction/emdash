export type MentionKeyAction = 'next' | 'prev' | 'select' | 'close' | 'none';

/**
 * Maximum number of file/folder results to show in mention dropdown.
 * Balances UI responsiveness with file discovery capabilities.
 */
export const MAX_MENTION_RESULTS = 100;

export const normalizeMentionQuery = (query: string): string => query.replace(/\\/g, '/');

export const getMentionBasePath = (itemPath: string, query: string): string => {
  const normalizedQuery = normalizeMentionQuery(query);
  if (!normalizedQuery) return '';
  if (itemPath.toLowerCase().startsWith(normalizedQuery.toLowerCase())) {
    return itemPath.slice(0, normalizedQuery.length);
  }
  return '';
};

export const getMentionKeyAction = ({
  active,
  hasItems,
  key,
  shiftKey = false,
}: {
  active: boolean;
  hasItems: boolean;
  key: string;
  shiftKey?: boolean;
}): MentionKeyAction => {
  if (!active) return 'none';
  if (key === 'Escape') return 'close';
  if (!hasItems) return 'none';
  if (key === 'ArrowDown') return 'next';
  if (key === 'ArrowUp') return 'prev';
  if (key === 'Enter' && !shiftKey) return 'select';
  if (key === 'Tab') return 'select';
  return 'none';
};

export const shouldCloseMentionDropdown = ({
  target,
  textareaEl,
  dropdownEl,
}: {
  target: Node | null;
  textareaEl?: { contains: (node: Node) => boolean } | null;
  dropdownEl?: { contains: (node: Node) => boolean } | null;
}): boolean => {
  if (!target) return false;
  if (textareaEl?.contains(target)) return false;
  if (dropdownEl?.contains(target)) return false;
  return true;
};
