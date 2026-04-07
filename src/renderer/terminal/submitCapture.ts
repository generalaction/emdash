import { stripAnsi } from '@shared/text/stripAnsi';

interface SubmittedInputState {
  currentInput: string;
  submittedText: string | null;
}

function processCharacter(
  state: SubmittedInputState,
  ch: string,
  isNewlineInsert: boolean
): SubmittedInputState {
  if (ch === '\r' || ch === '\n') {
    if (isNewlineInsert) {
      return { ...state, currentInput: state.currentInput + '\n' };
    }
    return {
      currentInput: '',
      submittedText: state.submittedText ?? (state.currentInput.trim() || null),
    };
  }

  if (ch === '\x15') {
    return { ...state, currentInput: '' };
  }

  if (ch === '\x7f' || ch === '\b') {
    return { ...state, currentInput: state.currentInput.slice(0, -1) };
  }

  if (ch.charCodeAt(0) >= 32) {
    return { ...state, currentInput: state.currentInput + ch };
  }

  return state;
}

export function consumeSubmittedInputChunk(args: {
  currentInput: string;
  data: string;
  isNewlineInsert: boolean;
}): SubmittedInputState {
  const clean = stripAnsi(args.data, { includePrivateCsiParams: true, stripOscSt: true });

  return clean.split('').reduce((state, ch) => processCharacter(state, ch, args.isNewlineInsert), {
    currentInput: args.currentInput,
    submittedText: null,
  } as SubmittedInputState);
}
