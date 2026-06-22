/**
 * SplitButton — a two-part button for elicitation rows.
 *
 * Left face: fires the currently-selected option.
 * Right chevron: opens a portaled dropdown listing all options so the user
 * can change the selected action before confirming.
 *
 * The menu renders via a Portal with fixed positioning so it never grows the
 * measured row height or gets clipped by the virtualizer's transform/overflow.
 * It closes on outside-click, Escape, and scroll/resize of the chat container.
 */

import { For, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { Portal } from 'solid-js/web';
import type { ChatElicitation, ChatElicitationOption } from '@/model';
import {
  dotAccept,
  dotNeutral,
  dotReject,
  menuItem,
  menuItemDot,
  menuItemSelected,
  menuPortal,
  splitButton,
  splitButtonChevron,
  splitButtonPrimary,
} from './elicitation.css';

export type SplitButtonProps = {
  item: ChatElicitation;
  onResolve: (optionId: string) => void;
};

function toneClass(option: ChatElicitationOption): string {
  if (option.tone === 'accept') return dotAccept;
  if (option.tone === 'reject') return dotReject;
  return dotNeutral;
}

export function SplitButton(props: SplitButtonProps) {
  const [selectedId, setSelectedId] = createSignal(props.item.defaultOptionId);
  const [menuOpen, setMenuOpen] = createSignal(false);

  let chevronRef: HTMLButtonElement | undefined;
  let menuRef: HTMLDivElement | undefined;

  const selectedOption = () =>
    props.item.options.find((o) => o.id === selectedId()) ?? props.item.options[0];

  // Menu position: align to the bottom-right of the chevron button.
  const [menuPos, setMenuPos] = createSignal({ top: 0, right: 0 });

  const openMenu = () => {
    const rect = chevronRef?.getBoundingClientRect();
    if (rect) {
      setMenuPos({
        top: rect.bottom + 4,
        right: window.innerWidth - rect.right,
      });
    }
    setMenuOpen(true);
  };

  const closeMenu = () => setMenuOpen(false);

  const selectOption = (id: string) => {
    setSelectedId(id);
    closeMenu();
  };

  // Close on outside-click, Escape, and chat-container scroll/resize.
  onMount(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMenu();
    };
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (menuRef && !menuRef.contains(target) && chevronRef && !chevronRef.contains(target)) {
        closeMenu();
      }
    };
    // Close on scroll of any ancestor (covers the virtualizer scroll container).
    const onScroll = () => closeMenu();

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown, { capture: true });
    // Attach to [data-chat-scroll] so only the chat container triggers close,
    // not every scroll on the page. Fall back to window if not found.
    const scrollEl = document.querySelector('[data-chat-scroll]') ?? window;
    scrollEl.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });

    onCleanup(() => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown, { capture: true });
      scrollEl.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    });
  });

  return (
    <div class={splitButton}>
      {/* Primary face */}
      <button
        class={splitButtonPrimary}
        type="button"
        onClick={() => props.onResolve(selectedId())}
      >
        {selectedOption()?.label ?? ''}
      </button>

      {/* Chevron toggle */}
      <button
        ref={(el) => {
          chevronRef = el;
        }}
        class={splitButtonChevron}
        type="button"
        aria-label="More options"
        aria-haspopup="listbox"
        aria-expanded={menuOpen() ? 'true' : 'false'}
        onClick={() => (menuOpen() ? closeMenu() : openMenu())}
      >
        ▾
      </button>

      {/* Portaled dropdown */}
      <Show when={menuOpen()}>
        <Portal>
          <div
            ref={(el) => {
              menuRef = el;
            }}
            class={menuPortal}
            style={{
              top: `${menuPos().top}px`,
              right: `${menuPos().right}px`,
            }}
            role="listbox"
          >
            <For each={props.item.options}>
              {(option) => (
                <button
                  class={`${menuItem}${option.id === selectedId() ? ` ${menuItemSelected}` : ''}`}
                  type="button"
                  role="option"
                  aria-selected={option.id === selectedId() ? 'true' : 'false'}
                  onClick={() => selectOption(option.id)}
                >
                  <span class={`${menuItemDot} ${toneClass(option)}`} aria-hidden="true" />
                  {option.label}
                </button>
              )}
            </For>
          </div>
        </Portal>
      </Show>
    </div>
  );
}
