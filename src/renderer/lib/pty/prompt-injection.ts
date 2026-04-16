export const INJECT_ENTER_DELAY_MS = 50;

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function pastePromptInjection(args: InjectPromptArgs): Promise<void> {
  const payload = buildPromptInjectionPayload({
    providerId: args.providerId,
    text: args.text,
  });
  if (!payload) return;
  await args.sendInput(payload);
}

export async function sendPromptInjection(args: InjectPromptArgs): Promise<void> {
  await pastePromptInjection(args);
  await sleep(INJECT_ENTER_DELAY_MS);
  await args.sendInput('\r');
}
