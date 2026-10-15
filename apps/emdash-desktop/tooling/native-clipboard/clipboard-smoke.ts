// Native clipboard checks for the terminal paste pipeline, run in Electron on each OS by
// run.mjs. They exercise the production clipboard snapshot against the real system clipboard,
// so run them only in CI or on a private display. Output reports sizes and hashes only.
import { createHash } from 'node:crypto';
import { app, BrowserWindow, clipboard, Menu, nativeImage } from 'electron';
import { readClipboardForPaste } from '@main/core/app/persist-terminal-attachment';

const isMac = process.platform === 'darwin';
const isLinux = process.platform === 'linux';

type Check = { name: string; status: 'ok' | 'FAIL' | 'SKIP'; detail?: unknown };
const checks: Check[] = [];

function check(name: string, ok: boolean, detail?: unknown): void {
  checks.push({ name, status: ok ? 'ok' : 'FAIL', detail });
}

function skip(name: string, reason: string): void {
  checks.push({ name, status: 'SKIP', detail: reason });
}

function digest(text: string) {
  return {
    length: text.length,
    sha256: createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16),
  };
}

function line(length: number): string {
  return 'x'.repeat(length - 8) + 'END_MARK';
}

function lines(length: number, eol = '\n'): string {
  const body = 'abcdefghijklmnopqrstuvwxyz0123456789_'.repeat(Math.ceil(length / 37) + 1);
  return body.replace(/.{79}/g, `$&${eol}`).slice(0, length - 8) + 'END_MARK';
}

const corpus: [string, string][] = [
  ['1,399-character line', line(1399)],
  ['1,400-character line', line(1400)],
  ['1,401-character line', line(1401)],
  ['1,400-character LF text', lines(1400)],
  ['1,400-character CRLF text', lines(1400, '\r\n')],
  ['whitespace', '\t  indented  \n\n  trailing  \n'],
  ['Unicode', 'é é 中文 🙂 👩‍💻 العربية'],
  ['embedded paste markers and C1', 'head\x1b[201~\nbody\u009b200~tail'],
  ['1 MiB text', lines(1024 * 1024)],
];

async function checkTextSnapshots(): Promise<void> {
  for (const [name, text] of corpus) {
    clipboard.writeText(text);
    const content = await readClipboardForPaste();
    const read = content.kind === 'text' ? content.text : '';
    check(`text snapshot: ${name}`, content.kind === 'text' && read === text, {
      wrote: digest(text),
      read: digest(read),
    });
  }
  clipboard.write({ text: 'cells as text', html: '<table><td>cells</td></table>' });
  const rich = await readClipboardForPaste();
  check(
    'rich text snapshot is its plain text',
    rich.kind === 'text' && rich.text === 'cells as text'
  );
}

async function checkImageSnapshot(): Promise<void> {
  const fixture = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAAC56t6BAAAAEUlEQVR4nGP4z8DwH4QZMBgAoXkL9U3EmgcAAAAASUVORK5CYII='
  );
  const size = fixture.getSize();
  check('image fixture decodes', !fixture.isEmpty() && size.width === 2 && size.height === 3, size);

  clipboard.writeImage(fixture);
  const onClipboard = clipboard.readImage('clipboard');
  check('image-only clipboard holds the image and no text', !onClipboard.isEmpty(), {
    size: onClipboard.getSize(),
    text: clipboard.readText('clipboard').length,
  });

  const content = await readClipboardForPaste();
  const persisted = content.kind === 'image' ? nativeImage.createFromPath(content.path) : null;
  check(
    'image snapshot persists the clipboard image',
    persisted !== null && !persisted.isEmpty() && persisted.getSize().width === 2,
    { kind: content.kind, size: persisted?.getSize() }
  );

  // The snapshot is a file: changing the clipboard afterwards cannot change what is attached.
  clipboard.writeText('later text');
  const again = content.kind === 'image' ? nativeImage.createFromPath(content.path) : null;
  check('image snapshot survives a later clipboard change', again?.getSize().height === 3);
}

async function checkPrimarySelection(): Promise<void> {
  if (!isLinux) return;
  clipboard.writeText('clipboard value', 'clipboard');
  clipboard.writeText('primary value', 'selection');
  check(
    'PRIMARY and CLIPBOARD stay separate',
    clipboard.readText('clipboard') === 'clipboard value' &&
      clipboard.readText('selection') === 'primary value'
  );
  const primary = await readClipboardForPaste('selection');
  const system = await readClipboardForPaste('clipboard');
  check(
    'snapshot reads PRIMARY only when asked',
    primary.kind === 'text' &&
      primary.text === 'primary value' &&
      system.kind === 'text' &&
      system.text === 'clipboard value'
  );
}

const PAGE = `<!doctype html><textarea id="t" style="position:absolute;left:10px;top:10px;width:300px;height:100px"></textarea>
<script>
  window.pastes = [];
  window.copies = [];
  window.preventShortcuts = false;
  window.preventMiddleClick = false;
  addEventListener('mouseup', (event) => {
    if (preventMiddleClick && event.button === 1) event.preventDefault();
  }, true);
  addEventListener('paste', (event) => {
    pastes.push(event.clipboardData.getData('text/plain'));
    event.preventDefault();
  }, true);
  addEventListener('copy', () => copies.push(document.getSelection().toString()), true);
  addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    if (preventShortcuts && (event.ctrlKey || event.metaKey) && (key === 'v' || key === 'c')) {
      event.preventDefault();
    }
  }, true);
</script>`;

// Test deadline for asynchronous input dispatch; the count, not the delay, is asserted.
async function eventsAfter(
  webContents: Electron.WebContents,
  kind: 'pastes' | 'copies',
  expected: number
): Promise<string[]> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const events: string[] = await webContents.executeJavaScript(`window.${kind}`);
    if (events.length > expected) return events;
    if (events.length === expected && attempt >= 4) return events;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return (await webContents.executeJavaScript(`window.${kind}`)) as string[];
}

async function reset(
  webContents: Electron.WebContents,
  preventShortcuts: boolean,
  preventMiddleClick = false
): Promise<void> {
  await webContents.executeJavaScript(
    `window.pastes = []; window.copies = []; window.preventShortcuts = ${preventShortcuts};
     window.preventMiddleClick = ${preventMiddleClick};
     { const field = document.getElementById('t'); field.value = 'copy me'; field.focus(); field.select(); }`
  );
}

function pressCtrl(webContents: Electron.WebContents, keyCode: 'C' | 'V'): void {
  webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers: ['control'] });
  webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers: ['control'] });
}

async function checkPasteEvents(): Promise<void> {
  // Mirrors the app menu's Edit roles, so the paste accelerator is registered as in the app.
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([{ label: 'Edit', submenu: [{ role: 'copy' }, { role: 'paste' }] }])
  );
  const win = new BrowserWindow({ width: 400, height: 300, show: true });
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(PAGE)}`);
  win.focus();
  win.webContents.focus();
  const { webContents } = win;
  const text = lines(1400, '\r\n');
  clipboard.writeText(text);

  // The Paste and Copy roles' actions (Edit menu, and the macOS Cmd+V/Cmd+C key equivalents).
  await reset(webContents, false);
  webContents.paste();
  const menuPastes = await eventsAfter(webContents, 'pastes', 1);
  check(
    'Edit > Paste delivers one event with the clipboard text',
    menuPastes.length === 1 && menuPastes[0] === text,
    { events: menuPastes.length }
  );
  await reset(webContents, false);
  webContents.copy();
  const menuCopies = await eventsAfter(webContents, 'copies', 1);
  check('Edit > Copy delivers one copy event', menuCopies.length === 1, {
    events: menuCopies.length,
  });

  if (isMac) {
    skip(
      'Cmd+V and Cmd+C shortcuts',
      'macOS routes them through NSMenu key equivalents, which synthesized input bypasses; the role actions above are what they invoke'
    );
  } else {
    clipboard.writeText(text);
    await reset(webContents, false);
    pressCtrl(webContents, 'V');
    const shortcutPastes = await eventsAfter(webContents, 'pastes', 1);
    check('Ctrl+V delivers one event', shortcutPastes.length === 1 && shortcutPastes[0] === text, {
      events: shortcutPastes.length,
    });
    await reset(webContents, false);
    pressCtrl(webContents, 'C');
    const shortcutCopies = await eventsAfter(webContents, 'copies', 1);
    check('Ctrl+C delivers one copy event', shortcutCopies.length === 1, {
      events: shortcutCopies.length,
    });

    // The terminal owns Windows/Linux copy and paste shortcuts by preventing the keydown
    // default; neither the editing command nor an Edit menu accelerator may act as well.
    await reset(webContents, true);
    pressCtrl(webContents, 'V');
    pressCtrl(webContents, 'C');
    const prevented = await eventsAfter(webContents, 'pastes', 0);
    const preventedCopies = await eventsAfter(webContents, 'copies', 0);
    check(
      'prevented Ctrl+V and Ctrl+C deliver no event',
      prevented.length === 0 && preventedCopies.length === 0,
      { pastes: prevented.length, copies: preventedCopies.length }
    );
  }

  if (isLinux) {
    clipboard.writeText('clipboard value', 'clipboard');
    clipboard.writeText('primary value', 'selection');
    await reset(webContents, false);
    for (const type of ['mouseDown', 'mouseUp'] as const) {
      webContents.sendInputEvent({ type, x: 60, y: 40, button: 'middle', clickCount: 1 });
    }
    const middle = await eventsAfter(webContents, 'pastes', 1);
    check('middle click pastes PRIMARY', middle.length === 1 && middle[0] === 'primary value', {
      events: middle.length,
    });

    // The terminal owns the middle click by preventing its mouseup, then reads PRIMARY itself.
    await reset(webContents, false, true);
    for (const type of ['mouseDown', 'mouseUp'] as const) {
      webContents.sendInputEvent({ type, x: 60, y: 40, button: 'middle', clickCount: 1 });
    }
    const prevented = await eventsAfter(webContents, 'pastes', 0);
    check('prevented middle-click mouseup delivers no paste event', prevented.length === 0, {
      events: prevented.length,
    });
  }
  win.destroy();
}

void app.whenReady().then(async () => {
  try {
    await checkTextSnapshots();
    await checkImageSnapshot();
    await checkPrimarySelection();
    await checkPasteEvents();
  } catch (error) {
    check('smoke run', false, String(error));
  }
  console.log(`${process.platform} Electron ${process.versions.electron}`);
  for (const { name, status, detail } of checks) {
    console.log(
      `${status.padEnd(4)} ${name}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`
    );
  }
  app.exit(checks.some((entry) => entry.status === 'FAIL') ? 1 : 0);
});
