import { stripAnsi } from './stripAnsi';

export function consumeSubmittedInputChunk(args: {
  currentInput: string;
  data: string;
  isNewlineInsert: boolean;
}): { currentInput: string; submittedText: string | null } {
  const clean = stripAnsi(args.data);
  let currentInput = args.currentInput;
  let submittedText: string | null = null;

  for (const ch of clean) {
    if (ch === '\r' || ch === '\n') {
      if (args.isNewlineInsert) {
        currentInput += '\n';
        continue;
      }
      if (submittedText === null) {
        submittedText = currentInput.trim() || null;
      }
      currentInput = '';
      continue;
    }

    if (ch === '\x15') {
      currentInput = '';
      continue;
    }

    if (ch === '\x7f' || ch === '\b') {
      currentInput = currentInput.slice(0, -1);
      continue;
    }

    if (ch.charCodeAt(0) >= 32) {
      currentInput += ch;
    }
  }

  return { currentInput, submittedText };
}
