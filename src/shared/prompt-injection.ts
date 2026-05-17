export function buildPromptInjectionPayload(args: {
  providerId: string | undefined;
  text: string;
}): string {
  const trimmed = args.text.trim();
  const hasMultilinePayload = trimmed.includes('\n');
  const shouldUseBracketedPaste = args.providerId !== 'claude' && hasMultilinePayload;
  if (!shouldUseBracketedPaste) return trimmed;
  return `\x1b[200~${trimmed}\x1b[201~`;
}
