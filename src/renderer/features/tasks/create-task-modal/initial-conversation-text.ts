export function appendInitialConversationText(currentPrompt: string, text: string): string {
  const nextText = text.trim();
  if (!nextText) return currentPrompt;
  return currentPrompt ? `${currentPrompt}\n${nextText}` : nextText;
}

const ISSUE_CONTEXT_START = '<issue_context>';
const ISSUE_CONTEXT_END = '</issue_context>';
const ISSUE_CONTEXT_BLOCK_PATTERN = new RegExp(
  `${ISSUE_CONTEXT_START}[\\s\\S]*?${ISSUE_CONTEXT_END}`
);

export function formatInitialIssueContextBlock(text: string): string {
  return `${ISSUE_CONTEXT_START}\n${text.trim()}\n${ISSUE_CONTEXT_END}`;
}

export function hasInitialIssueContext(currentPrompt: string): boolean {
  return ISSUE_CONTEXT_BLOCK_PATTERN.test(currentPrompt);
}

export function upsertInitialIssueContext(currentPrompt: string, text: string): string {
  const nextBlock = formatInitialIssueContextBlock(text);

  if (hasInitialIssueContext(currentPrompt)) {
    return currentPrompt.replace(ISSUE_CONTEXT_BLOCK_PATTERN, nextBlock);
  }

  return appendInitialConversationText(currentPrompt, nextBlock);
}
