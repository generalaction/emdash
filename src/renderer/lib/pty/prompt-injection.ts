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

type SendInput = (data: string) => Promise<unknown>;

type InjectPromptArgs = {
  providerId: string | undefined;
  text: string;
  sendInput: SendInput;
};

export async function pastePromptInjection(args: InjectPromptArgs): Promise<void> {
  const payload = buildPromptInjectionPayload({
    providerId: args.providerId,
    text: args.text,
  });
  if (!payload) return;
  await args.sendInput(payload);
}
