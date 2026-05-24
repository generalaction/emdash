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
const ISSUE_CONTEXT_TEXT_PATTERN = /^Provider: .+\. Identifier: .+/m;

export function formatInitialIssueContextBlock(text: string): string {
  return text.trim();
}

export function hasInitialIssueContext(currentPrompt: string): boolean {
  return (
    ISSUE_CONTEXT_BLOCK_PATTERN.test(currentPrompt) ||
    ISSUE_CONTEXT_TEXT_PATTERN.test(currentPrompt)
  );
}

export function upsertInitialIssueContext(currentPrompt: string, text: string): string {
  const nextBlock = formatInitialIssueContextBlock(text);

  if (hasInitialIssueContext(currentPrompt)) {
    return currentPrompt.replace(ISSUE_CONTEXT_BLOCK_PATTERN, nextBlock);
  }

  return appendInitialConversationText(currentPrompt, nextBlock);
}
