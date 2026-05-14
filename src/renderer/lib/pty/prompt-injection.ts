import { buildPromptInjectionPayload } from '@shared/prompt-injection';

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
