export function buildPromptInjectionPayload(args: {
  providerId: string | undefined;
  text: string;
  forceBracketedPaste?: boolean;
}): string {
  const trimmed = args.text.trim();
  const hasMultilinePayload = trimmed.includes('\n');
  const shouldUseBracketedPaste =
    args.forceBracketedPaste || (hasMultilinePayload && args.providerId !== 'claude');
  if (!shouldUseBracketedPaste) return trimmed;
  return `\x1b[200~${trimmed}\x1b[201~`;
}

type SendInput = (data: string) => Promise<unknown>;

type InjectPromptArgs = {
  providerId: string | undefined;
  text: string;
  forceBracketedPaste?: boolean;
  sendInput: SendInput;
};

export async function pastePromptInjection(args: InjectPromptArgs): Promise<void> {
  const payload = buildPromptInjectionPayload({
    providerId: args.providerId,
    text: args.text,
    forceBracketedPaste: args.forceBracketedPaste,
  });
  if (!payload) return;
  await args.sendInput(payload);
}
