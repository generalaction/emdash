import '@emdash/ui/style.css';
import { Button, Dialog, DirectoryField, Field, ModalLayout } from '@emdash/ui/react/primitives';
import { page } from '@vitest/browser/context';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('Dialog layout', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it.each([375, 1024])(
    'keeps a long directory path inside an animated modal at %ipx',
    async (width) => {
      await page.viewport(width, 800);

      const renderPath = async (path: string) => {
        await act(async () => {
          root.render(
            <Dialog.Root open>
              <Dialog.Content style={{ animation: 'none' }}>
                <ModalLayout
                  header={
                    <Dialog.Header>
                      <Dialog.Title>Add Project</Dialog.Title>
                    </Dialog.Header>
                  }
                  footer={
                    <Dialog.Footer>
                      <Button>Create</Button>
                    </Dialog.Footer>
                  }
                >
                  <Dialog.Body>
                    <Field.Group>
                      <Field.Root>
                        <Field.Label>Directory</Field.Label>
                        <DirectoryField path={path} />
                      </Field.Root>
                    </Field.Group>
                  </Dialog.Body>
                </ModalLayout>
              </Dialog.Content>
            </Dialog.Root>
          );
        });
      };

      await renderPath('/Users/developer/emdash');
      const popup = document.querySelector<HTMLElement>('[data-slot="dialog-content"]')!;
      const body = popup.querySelector<HTMLElement>('[data-slot="dialog-body"]')!;
      const field = popup.querySelector<HTMLButtonElement>('[data-slot="directory-field"]')!;
      const value = field.querySelector('span')!;
      const choose = field.lastElementChild!;
      const initialWidth = popup.offsetWidth;

      await renderPath(`/Users/developer/${'deeply-nested-directory/'.repeat(12)}emdash`);

      const popupBounds = popup.getBoundingClientRect();
      expect(popup.offsetWidth).toBe(initialWidth);
      expect(popupBounds.left).toBeGreaterThanOrEqual(0);
      expect(popupBounds.right).toBeLessThanOrEqual(width);
      expect(body.getBoundingClientRect().right).toBeLessThanOrEqual(popupBounds.right + 0.5);
      expect(popup.scrollWidth).toBeLessThanOrEqual(popup.clientWidth);
      expect(choose.getBoundingClientRect().right).toBeLessThanOrEqual(popupBounds.right);
      expect(value.scrollWidth).toBeGreaterThan(value.clientWidth);
      expect(getComputedStyle(value).textOverflow).toBe('ellipsis');
    }
  );

  it('keeps an unconstrained long body scrollable above the footer', async () => {
    await act(async () => {
      root.render(
        <Dialog.Root open>
          <Dialog.Content size="lg">
            <Dialog.Header>
              <Dialog.Title>Long dialog</Dialog.Title>
            </Dialog.Header>
            <Dialog.Body>
              {Array.from({ length: 80 }, (_, index) => (
                <p key={index}>Dialog body line {index + 1}</p>
              ))}
            </Dialog.Body>
            <Dialog.Footer>
              <Button>Footer action</Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Root>
      );
    });

    const popup = document.querySelector<HTMLElement>('[data-slot="dialog-content"]');
    const viewport = popup?.querySelector<HTMLElement>('.scroll-fade__viewport');
    const footer = popup?.querySelector<HTMLElement>('[data-slot="dialog-footer"]');

    expect(popup).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(footer).not.toBeNull();
    expect(viewport!.scrollHeight).toBeGreaterThan(viewport!.clientHeight);
    expect(viewport!.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      footer!.getBoundingClientRect().top + 0.5
    );
    expect(popup!.scrollHeight).toBeLessThanOrEqual(popup!.clientHeight);
  });

  it('honors an explicit body height instead of sizing to content', async () => {
    // Tall enough that the popup's max-height cannot shrink the fixed body.
    await page.viewport(1024, 800);
    await act(async () => {
      root.render(
        <Dialog.Root open>
          <Dialog.Content size="lg">
            <Dialog.Header>
              <Dialog.Title>Fixed-height dialog</Dialog.Title>
            </Dialog.Header>
            <Dialog.Body height={520}>
              <p>Short content</p>
            </Dialog.Body>
            <Dialog.Footer>
              <Button>Footer action</Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Root>
      );
    });

    const body = document.querySelector<HTMLElement>('[data-slot="dialog-body"]');

    expect(body).not.toBeNull();
    // offsetHeight: the popup's zoom-in animation scales the border box, so
    // getBoundingClientRect would under-report until the animation finishes.
    expect(body!.offsetHeight).toBe(520);
  });
});
