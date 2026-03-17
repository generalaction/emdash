import { describe, expect, it } from 'vitest';
import { shouldCloseExpandedTerminal } from '../../renderer/lib/expandedTerminal';

describe('shouldCloseExpandedTerminal', () => {
  it('closes on Escape for regular targets', () => {
    expect(shouldCloseExpandedTerminal({ key: 'Escape', target: {} as EventTarget })).toBe(true);
  });

  it('closes on Escape when xterm helper textarea is focused', () => {
    const target = {
      classList: {
        contains: (value: string) => value === 'xterm-helper-textarea',
      },
    } as unknown as EventTarget;

    expect(shouldCloseExpandedTerminal({ key: 'Escape', target })).toBe(true);
  });

  it('ignores other keys', () => {
    expect(shouldCloseExpandedTerminal({ key: 'Enter', target: {} as EventTarget })).toBe(false);
  });
});
