export function appendInitialConversationText(currentPrompt: string, text: string): string {
  const nextText = text.trim();
  if (!nextText) return currentPrompt;
  return currentPrompt ? `${currentPrompt}\n${nextText}` : nextText;
}

const ISSUE_CONTEXT_START = '<issue_context>';
const ISSUE_CONTEXT_END = '</issue_context>';
const ISSUE_CONTEXT_BLOCK_PATTERN = new RegExp(
  `\\n*${ISSUE_CONTEXT_START}[\\s\\S]*?${ISSUE_CONTEXT_END}\\n*`
);

export function formatInitialIssueContextBlock(text: string): string {
  return `${ISSUE_CONTEXT_START}\n${text.trim()}\n${ISSUE_CONTEXT_END}`;
}

export function upsertInitialIssueContext(currentPrompt: string, text: string): string {
  const nextBlock = formatInitialIssueContextBlock(text);

  if (ISSUE_CONTEXT_BLOCK_PATTERN.test(currentPrompt)) {
    return currentPrompt.replace(ISSUE_CONTEXT_BLOCK_PATTERN, (match) => {
      const prefix = match.startsWith('\n') ? '\n' : '';
      const suffix = match.endsWith('\n') ? '\n' : '';
      return `${prefix}${nextBlock}${suffix}`;
    });
  }

  return appendInitialConversationText(currentPrompt, nextBlock);
}
