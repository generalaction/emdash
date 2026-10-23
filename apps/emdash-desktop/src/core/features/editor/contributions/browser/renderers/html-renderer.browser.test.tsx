import { encodeResourceUri } from '@emdash/core/primitives/path/api';
import { ok } from '@emdash/shared';
import { createInProcessWire, defineContract } from '@emdash/wire/rpc';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { filesWireContract } from '@core/features/files/api';
import { hostFileRefFromNativePath } from '@core/primitives/desktop-runtime/api';
import { resetWireConnection, seedWireConnection } from '@core/primitives/wire/browser/connection';
import { PaneContext } from '@core/primitives/workbench-shell/browser/tabs/pane-context';
import { HtmlContentRenderer } from './html-renderer';

it('loads relative HTML assets from the inspected checkout and blocks editable file navigation', async () => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  const css = 'body { color: rgb(1, 2, 3); }';
  const readText = vi.fn(async () =>
    ok({ content: css, etag: 'css', truncated: false, totalSize: css.length })
  );
  const wire = createInProcessWire(
    defineContract({
      files: defineContract({ fs: defineContract({ readText: filesWireContract.fs.readText }) }),
    }),
    { files: { fs: { readText } } },
    { validate: 'full' }
  );
  resetWireConnection();
  seedWireConnection(async () => wire.connection);
  const open = vi.fn();
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const render = async (readOnly: boolean) =>
    act(async () =>
      root.render(
        <PaneContext.Provider
          value={{
            paneId: 'pane',
            pane: { open } as never,
            scopeInstance: undefined,
            isFocusedPane: true,
          }}
        >
          <HtmlContentRenderer
            workspacePath="/repo/task/subagent"
            filePath="/repo/task/subagent/index.html"
            rawContent={
              '<link rel="stylesheet" href="./style.css"><a href="./sibling.html">Sibling</a>'
            }
            readOnly={readOnly}
          />
        </PaneContext.Provider>
      )
    );

  try {
    await render(true);
    await vi.waitFor(() => expect(host.querySelector('iframe')?.srcdoc).toContain(css));
    expect(readText).toHaveBeenCalledWith(
      expect.objectContaining({
        uri: encodeResourceUri(hostFileRefFromNativePath('/repo/task/subagent/style.css')),
      }),
      expect.anything()
    );
    const iframe = host.querySelector('iframe')!;
    const clickLink = () =>
      window.dispatchEvent(
        new MessageEvent('message', {
          source: iframe.contentWindow,
          data: { type: 'emdash-html-link', href: './sibling.html' },
        })
      );
    clickLink();
    expect(open).not.toHaveBeenCalled();
    await render(false);
    clickLink();
    expect(open).toHaveBeenCalledWith('file', {
      path: '/repo/task/subagent/sibling.html',
      preview: false,
    });
  } finally {
    await act(async () => root.unmount());
    host.remove();
    resetWireConnection();
    await wire.dispose();
  }
});
