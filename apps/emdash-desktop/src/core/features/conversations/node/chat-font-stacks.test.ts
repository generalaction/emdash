import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// This convergence test reads index.css from disk, so it lives in the node
// surface even though the constants under test are browser code.
import { CHAT_FONT_MONO, CHAT_FONT_SANS } from '../api/browser/chat/chat-font-stacks';

function readFontVarDeclarations(css: string, varName: string): string[][] {
  const pattern = new RegExp(`${varName}:\\s*([^;]+);`, 'g');
  return [...css.matchAll(pattern)].map((match) =>
    (match[1] ?? '')
      .split(',')
      .map((entry) => entry.trim().replace(/^['"]|['"]$/g, ''))
      .filter((entry) => entry.length > 0)
  );
}

// chat-ui pre-measures transcript lines with ChatConfig.fonts and positions fragments
// absolutely, so the CSS vars that actually render the text must list the same families
// in the same order — otherwise lines clip at the right edge of the chat column.
describe('chat font stack convergence with index.css', () => {
  const css = readFileSync(new URL('../../../../renderer/index.css', import.meta.url), 'utf8');

  it('keeps every --chat-font-sans declaration in index.css identical to CHAT_FONT_SANS', () => {
    const declarations = readFontVarDeclarations(css, '--chat-font-sans');

    // .emlight and .emdark both declare it.
    expect(declarations).toHaveLength(2);
    for (const families of declarations) {
      expect(families).toEqual(CHAT_FONT_SANS);
    }
  });

  it('keeps every --chat-font-mono declaration in index.css identical to CHAT_FONT_MONO', () => {
    const declarations = readFontVarDeclarations(css, '--chat-font-mono');

    expect(declarations).toHaveLength(2);
    for (const families of declarations) {
      expect(families).toEqual(CHAT_FONT_MONO);
    }
  });
});
