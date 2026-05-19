export function buildPromptInjectionPayload(args: {
  providerId: string | undefined;
  text: string;
  forceBracketedPaste?: boolean;
}): string {
  const trimmed = args.text.trim();
  const hasMultilinePayload = trimmed.includes('\n');
  const shouldUseBracketedPaste =
    hasMultilinePayload && (args.forceBracketedPaste || args.providerId !== 'claude');
  if (!shouldUseBracketedPaste) return trimmed;
  return `\x1b[200~${trimmed}\x1b[201~`;
}
