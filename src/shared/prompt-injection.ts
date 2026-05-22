export function buildPromptInjectionPayload(args: {
  providerId: string | undefined;
  text: string;
  forceBracketedPaste?: boolean;
}): string {
  // A bare trailing newline is the user asking the shell to execute the
  // pasted line; only internal newlines need bracketed paste to avoid
  // submitting each line before the rest arrives.
  const hasInternalNewlines = args.text.replace(/\r?\n$/, '').includes('\n');
  const shouldUseBracketedPaste =
    args.forceBracketedPaste || (args.providerId !== 'claude' && hasInternalNewlines);
  if (!shouldUseBracketedPaste) return args.text;
  return `\x1b[200~${args.text}\x1b[201~`;
}
