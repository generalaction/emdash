export function appendInitialConversationText(currentPrompt: string, text: string): string {
  const nextText = text.trim();
  if (!nextText) return currentPrompt;
  return currentPrompt ? `${currentPrompt}\n${nextText}` : nextText;
}
