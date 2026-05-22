/**
 * `mode` distinguishes user-driven pastes from automated initial-prompt
 * injection at session start. Claude's TUI handles bracketed paste correctly
 * for ordinary clipboard pastes but mishandles it when used to type the
 * initial task prompt, so the Claude exemption applies only to initial-prompt
 * mode (see commit 20610a16, "fix(opencode): submit initial prompt reliably").
 */
export type PromptInjectionMode = 'paste' | 'initial-prompt';

export function buildPromptInjectionPayload(args: {
  providerId: string | undefined;
  text: string;
  mode: PromptInjectionMode;
  forceBracketedPaste?: boolean;
}): string {
  // A bare trailing newline is the user asking the shell to execute the
  // pasted line; only internal newlines need bracketed paste to avoid
  // submitting each line before the rest arrives.
  const hasInternalNewlines = args.text.replace(/\r?\n$/, '').includes('\n');
  const skipBracketForClaudeInitial =
    args.mode === 'initial-prompt' && args.providerId === 'claude';
  const shouldUseBracketedPaste =
    args.forceBracketedPaste || (hasInternalNewlines && !skipBracketForClaudeInitial);
  if (!shouldUseBracketedPaste) return args.text;
  return `\x1b[200~${args.text}\x1b[201~`;
}
