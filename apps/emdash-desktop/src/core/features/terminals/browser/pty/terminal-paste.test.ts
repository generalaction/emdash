import { deferred } from '@emdash/shared/testing';
import type { Terminal } from '@xterm/xterm';
import { describe, expect, it, vi } from 'vitest';
import {
  effectiveBracketedPaste,
  MAX_TERMINAL_PASTE_BYTES,
  pasteActsAsKeystrokes,
  prepareTerminalPasteText,
  readPasteEventContent,
  TerminalInputQueue,
  unlessAborted,
  utf8ByteLength,
  whenOutputParsed,
} from './terminal-paste';

function clipboardData(entries: {
  text?: string;
  html?: string;
  files?: File[];
  types?: string[];
}): DataTransfer {
  const strings: Record<string, string> = {};
  if (entries.text !== undefined) strings['text/plain'] = entries.text;
  if (entries.html !== undefined) strings['text/html'] = entries.html;
  const files = entries.files ?? [];
  return {
    getData: (type: string) => strings[type] ?? '',
    items: files.map((file) => ({ kind: 'file', getAsFile: () => file })),
    types: entries.types ?? [...Object.keys(strings), ...(files.length ? ['Files'] : [])],
  } as unknown as DataTransfer;
}

const bitmap = new File(['png'], 'image.png', { type: 'image/png', lastModified: 1 });
const noPath = () => '';

describe('prepareTerminalPasteText', () => {
  it.each([
    ['ordinary text', 'hello world'],
    ['indentation and trailing whitespace', '\t  indented  \n\n'],
    ['LF, CRLF, CR and mixed endings', 'one\ntwo\r\nthree\rfour\r\n'],
    ['accents, combining marks and wide text', 'é é 中文 한국어'],
    ['emoji and ZWJ sequences', '🙂 👩‍💻 🏳️‍🌈'],
    ['right-to-left text', 'العربية עברית'],
    ['Latin-1 text after the C1 range', '\u00a0é ÿ'],
    ['visible control pictures', '␛[201~ ␀'],
  ])('leaves %s unchanged', (_name, text) => {
    expect(prepareTerminalPasteText(text)).toBe(text);
  });

  it('shows every C0 control except HT, LF and CR as its control picture', () => {
    for (let code = 0; code < 0x20; code++) {
      const control = String.fromCharCode(code);
      const expected = [0x09, 0x0a, 0x0d].includes(code)
        ? control
        : String.fromCharCode(0x2400 + code);
      expect(prepareTerminalPasteText(`a${control}b`)).toBe(`a${expected}b`);
    }
    expect(prepareTerminalPasteText('a\x7fb')).toBe('a␡b');
  });

  it('matches upstream xterm.js by showing ESC as U+241B', () => {
    expect(prepareTerminalPasteText('head\x1b[201~\nbody\x1b[200~tail')).toBe(
      'head␛[201~\nbody␛[200~tail'
    );
  });

  it('shows C1 controls as the ESC sequences they stand for', () => {
    // U+009B is the 8-bit CSI and U+0085 is NEL; neither may reach the terminal as a control.
    expect(prepareTerminalPasteText('a\u009b201~b\u0085c')).toBe('a\u241b[201~b\u241bEc');
    for (let code = 0x80; code <= 0x9f; code++) {
      expect(prepareTerminalPasteText(String.fromCharCode(code))).toBe(
        `\u241b${String.fromCharCode(code - 0x40)}`
      );
    }
  });

  it('cannot interrupt, end input, or erase earlier pasted text', () => {
    const prepared = prepareTerminalPasteText('keep\x08\x7f\x15\x03\x04\x1a\x1c\x00end');
    expect(prepared).toBe('keep␈␡␕␃␄␚␜␀end');
    expect(prepared).not.toMatch(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/);
  });
});

function fakeTerminal(options: { bracketed?: boolean; ignore?: boolean } = {}) {
  const callbacks: (() => void)[] = [];
  const terminal = {
    modes: { bracketedPasteMode: options.bracketed ?? false },
    options: { ignoreBracketedPasteMode: options.ignore },
    write: vi.fn((_data: string, callback?: () => void) => {
      if (callback) callbacks.push(callback);
    }),
  };
  return {
    terminal: terminal as unknown as Terminal,
    write: terminal.write,
    parse: () => callbacks.splice(0).forEach((callback) => callback()),
  };
}

describe('effectiveBracketedPaste', () => {
  it('follows the destination mode unless xterm ignores it', () => {
    expect(effectiveBracketedPaste(fakeTerminal({ bracketed: true }).terminal)).toBe(true);
    expect(effectiveBracketedPaste(fakeTerminal({ bracketed: false }).terminal)).toBe(false);
    expect(effectiveBracketedPaste(fakeTerminal({ bracketed: true, ignore: true }).terminal)).toBe(
      false
    );
  });
});

describe('whenOutputParsed', () => {
  it('resolves after xterm parses the output written before it', async () => {
    const { terminal, write, parse } = fakeTerminal();
    let parsed: boolean | undefined;
    void whenOutputParsed(terminal, new AbortController().signal).then((value) => {
      parsed = value;
    });
    expect(write).toHaveBeenCalledWith('', expect.any(Function));
    await Promise.resolve();
    expect(parsed).toBeUndefined();
    parse();
    await vi.waitFor(() => expect(parsed).toBe(true));
  });

  it('does not wait on an already-aborted lifetime', async () => {
    const { terminal, write } = fakeTerminal();
    const lifetime = new AbortController();
    lifetime.abort();
    await expect(whenOutputParsed(terminal, lifetime.signal)).resolves.toBe(false);
    expect(write).not.toHaveBeenCalled();
  });

  it('stops waiting when the lifetime aborts and the parse never completes', async () => {
    const { terminal } = fakeTerminal();
    const lifetime = new AbortController();
    const removeListener = vi.spyOn(lifetime.signal, 'removeEventListener');
    const parsed = whenOutputParsed(terminal, lifetime.signal);
    lifetime.abort();
    await expect(parsed).resolves.toBe(false);
    expect(removeListener).toHaveBeenCalled();
  });

  it('removes its abort listener after a normal parse', async () => {
    const { terminal, parse } = fakeTerminal();
    const lifetime = new AbortController();
    const removeListener = vi.spyOn(lifetime.signal, 'removeEventListener');
    const parsed = whenOutputParsed(terminal, lifetime.signal);
    parse();
    await expect(parsed).resolves.toBe(true);
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('treats a disposed terminal that throws on write as cancelled', async () => {
    const terminal = {
      write: () => {
        throw new Error('disposed');
      },
    } as unknown as Terminal;
    await expect(whenOutputParsed(terminal, new AbortController().signal)).resolves.toBe(false);
  });
});

describe('unlessAborted', () => {
  it('returns the value, or the cancellation as soon as the lifetime aborts', async () => {
    await expect(
      unlessAborted(Promise.resolve('read'), new AbortController().signal, 'x')
    ).resolves.toBe('read');
    const lifetime = new AbortController();
    const pending = unlessAborted(new Promise<string>(() => {}), lifetime.signal, 'cancelled');
    lifetime.abort();
    await expect(pending).resolves.toBe('cancelled');
  });
});

describe('pasteActsAsKeystrokes', () => {
  it('only flags line breaks and tabs when bracketed paste is off', () => {
    for (const text of ['a\nb', 'a\r\nb', 'a\rb', 'command\n', 'a\tb']) {
      expect(pasteActsAsKeystrokes(text, false)).toBe(true);
      expect(pasteActsAsKeystrokes(text, true)).toBe(false);
    }
    expect(pasteActsAsKeystrokes('single line with spaces', false)).toBe(false);
  });
});

describe('utf8ByteLength', () => {
  it.each(['', 'ascii', 'é中🙂👩‍💻', '\ud83d', 'a\udc00b', 'x'.repeat(1024 * 1024 - 8) + 'END_MARK'])(
    'matches TextEncoder for %#',
    (text) => {
      expect(utf8ByteLength(text)).toBe(new TextEncoder().encode(text).byteLength);
    }
  );

  it('admits a paste at the limit and measures the next byte past it', () => {
    expect(utf8ByteLength('x'.repeat(MAX_TERMINAL_PASTE_BYTES))).toBe(MAX_TERMINAL_PASTE_BYTES);
    expect(utf8ByteLength('x'.repeat(MAX_TERMINAL_PASTE_BYTES - 1) + 'é')).toBe(
      MAX_TERMINAL_PASTE_BYTES + 1
    );
  });
});

describe('paste content priority', () => {
  it('prefers text over the HTML and bitmap renditions a rich source adds', () => {
    const data = clipboardData({ text: 'cells', html: '<table/>', files: [bitmap] });
    expect(readPasteEventContent(data, noPath)).toEqual({ kind: 'text', text: 'cells' });
  });

  it('attaches image data when the clipboard has no text', () => {
    expect(readPasteEventContent(clipboardData({ files: [bitmap] }), noPath)).toEqual({
      kind: 'image-files',
      files: [bitmap],
    });
  });

  it('attaches image files referenced on disk instead of pasting their names', () => {
    const photo = new File(['png'], 'photo.png', { type: 'image/png', lastModified: 2 });
    const data = clipboardData({ text: 'photo.png', files: [photo] });
    expect(readPasteEventContent(data, () => '/Users/me/photo.png')).toEqual({
      kind: 'image-files',
      files: [photo],
    });
    expect(readPasteEventContent(data, () => '/var/folders/x/T/Drops/photo.png')).toEqual({
      kind: 'text',
      text: 'photo.png',
    });
  });

  it('falls back to the native image when only an image type is advertised', () => {
    const data = clipboardData({ types: ['image/heic'] });
    expect(readPasteEventContent(data, noPath)).toEqual({ kind: 'native-image' });
  });

  it('reports an empty payload', () => {
    expect(readPasteEventContent(clipboardData({}), noPath)).toEqual({ kind: 'empty' });
    expect(readPasteEventContent(null, noPath)).toEqual({ kind: 'empty' });
  });
});

describe('TerminalInputQueue', () => {
  it('sends input immediately while nothing is queued', () => {
    const queue = new TerminalInputQueue();
    const sent: string[] = [];
    queue.send(() => sent.push('a'));
    queue.send(() => sent.push('b'));
    expect(sent).toEqual(['a', 'b']);
  });

  it('holds typed input behind a paste until its clipboard read and commit finish', async () => {
    const queue = new TerminalInputQueue();
    const sent: string[] = [];
    const read = deferred<string>();
    queue.paste(read.promise, (value) => void sent.push(value), vi.fn());
    queue.send(() => sent.push('X'));
    queue.send(() => sent.push('\r'));
    await Promise.resolve();
    expect(sent).toEqual([]);
    read.resolve('PASTE');
    await vi.waitFor(() => expect(sent).toEqual(['PASTE', 'X', '\r']));
    // Once drained, input is immediate again.
    queue.send(() => sent.push('Y'));
    await vi.waitFor(() => expect(sent.at(-1)).toBe('Y'));
  });

  it('keeps pastes and input in invocation order when a later read resolves first', async () => {
    const queue = new TerminalInputQueue();
    const sent: string[] = [];
    const first = deferred<string>();
    const second = deferred<string>();
    queue.paste(first.promise, (value) => void sent.push(value), vi.fn());
    queue.send(() => sent.push('a'));
    queue.paste(second.promise, (value) => void sent.push(value), vi.fn());
    queue.paste('third', (value) => void sent.push(value), vi.fn());
    queue.send(() => sent.push('b'));
    second.resolve('second');
    await Promise.resolve();
    expect(sent).toEqual([]);
    first.resolve('first');
    await vi.waitFor(() => expect(sent).toEqual(['first', 'a', 'second', 'third', 'b']));
  });

  it('waits for an asynchronous commit, such as a confirmation, before later input', async () => {
    const queue = new TerminalInputQueue();
    const sent: string[] = [];
    const confirmation = deferred<void>();
    queue.paste(
      'paste',
      async (value) => {
        await confirmation.promise;
        sent.push(value);
      },
      vi.fn()
    );
    queue.send(() => sent.push('typed'));
    await Promise.resolve();
    expect(sent).toEqual([]);
    confirmation.resolve();
    await vi.waitFor(() => expect(sent).toEqual(['paste', 'typed']));
  });

  it('reports a failed read in order and discards the keys typed after it', async () => {
    const onDiscard = vi.fn();
    const queue = new TerminalInputQueue(onDiscard);
    const events: string[] = [];
    const first = deferred<string>();
    const failed = deferred<string>();
    queue.paste(first.promise, (value) => void events.push(value), vi.fn());
    queue.send(() => events.push('after first'));
    queue.paste(
      failed.promise,
      (value) => void events.push(value),
      (error) => events.push(`error:${(error as Error).message}`)
    );
    queue.send(() => events.push('X'));
    queue.send(() => events.push('\r'));
    queue.paste('next', (value) => void events.push(value), vi.fn());
    queue.send(() => events.push('after next'));
    failed.reject(new Error('denied'));
    await Promise.resolve();
    expect(events).toEqual([]);
    first.resolve('first');
    await vi.waitFor(() =>
      expect(events).toEqual(['first', 'after first', 'error:denied', 'next', 'after next'])
    );
    expect(onDiscard).toHaveBeenCalledExactlyOnceWith(2);
  });

  it.each([
    ['declines', () => false as const],
    [
      'throws',
      () => {
        throw new Error('boom');
      },
    ],
  ])(
    'discards held keys when the commit %s, then sends new input at once',
    async (_name, commit) => {
      const onDiscard = vi.fn();
      const queue = new TerminalInputQueue(onDiscard);
      const sent: string[] = [];
      queue.paste('paste', commit, () => {
        throw new Error('reporter failed');
      });
      queue.send(() => sent.push('X'));
      queue.send(() => sent.push('\r'));
      await vi.waitFor(() => expect(onDiscard).toHaveBeenCalledExactlyOnceWith(2));
      expect(sent).toEqual([]);
      queue.send(() => sent.push('Y'));
      expect(sent).toEqual(['Y']);
    }
  );

  it('sends held keys after a commit with nothing to paste', async () => {
    const queue = new TerminalInputQueue();
    const sent: string[] = [];
    queue.paste('empty', () => true, vi.fn());
    queue.send(() => sent.push('X'));
    await vi.waitFor(() => expect(sent).toEqual(['X']));
  });

  it('discards held input and ignores later input once its lifetime closes', async () => {
    const onDiscard = vi.fn();
    const queue = new TerminalInputQueue(onDiscard);
    const sent: string[] = [];
    const read = deferred<string>();
    const commit = vi.fn();
    const cancelled: string[] = [];
    queue.paste(read.promise, commit, vi.fn(), () => cancelled.push('in flight'));
    queue.send(() => sent.push('X'));
    queue.paste('queued', commit, vi.fn(), () => cancelled.push('queued'));
    queue.send(() => sent.push('\r'));
    queue.close();
    expect(onDiscard).toHaveBeenCalledExactlyOnceWith(2);
    expect(cancelled).toEqual(['queued']);
    queue.send(() => sent.push('late'));
    queue.paste('after close', commit, vi.fn(), () => cancelled.push('after close'));
    read.resolve('PASTE');
    await vi.waitFor(() => expect(cancelled).toEqual(['queued', 'after close', 'in flight']));
    expect(commit).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });
});
