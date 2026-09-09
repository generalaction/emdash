/**
 * ComboboxPopup — standalone stories for the floating listbox primitive.
 *
 * Since ComboboxPopup anchors itself to a DOMRect, each story wraps it in a
 * button that supplies its own bounding rect as the anchor. Keyboard events
 * are forwarded through the imperative handle.
 */

import { tokens } from '@emdash/theme';
import { Devicon } from '@react/components/devicon/devicon';
import { Button } from '@react/primitives/button';
import { Icon } from '@react/primitives/icon';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { cx, sx } from '@styles/index';
import { AtSign, Braces, CircleDot, File } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { ComboboxPopup, type ComboboxPopupHandle, type ComboboxPopupItem } from './combobox-popup';

const meta: Meta = {
  title: 'Primitives/ComboboxPopup',
  parameters: { layout: 'centered' },
};
export default meta;
type Story = StoryObj;

const FILE_ITEMS: ComboboxPopupItem[] = [
  {
    id: 'src/components/chat-composer.tsx',
    icon: <Devicon iconClass="devicon-react-original colored" size={13} />,
    label: 'chat-composer.tsx',
    description: 'src/components',
  },
  {
    id: 'src/lib/file-icons.ts',
    icon: <Devicon iconClass="devicon-typescript-plain colored" size={13} />,
    label: 'file-icons.ts',
    description: 'src/lib',
  },
  {
    id: 'package.json',
    icon: <Devicon iconClass="devicon-npm-original-wordmark colored" size={13} />,
    label: 'package.json',
    description: '',
  },
  {
    id: 'README.md',
    icon: <Devicon iconClass="devicon-markdown-original" size={13} />,
    label: 'README.md',
    description: '',
  },
];

const MIXED_ITEMS: ComboboxPopupItem[] = [
  { id: 'f1', icon: <Icon source={File} size="sm" />, label: 'src/utils.ts', description: 'file' },
  {
    id: 'i1',
    icon: <Icon source={CircleDot} size="sm" />,
    label: 'Issue #42',
    description: 'issue',
  },
  {
    id: 's1',
    icon: <Icon source={Braces} size="sm" />,
    label: 'handleSubmit',
    description: 'symbol',
  },
  {
    id: 'c1',
    icon: <Icon source={AtSign} size="sm" />,
    label: 'custom item',
    description: 'custom',
  },
];

function AnchoredPopup({
  items,
  emptyLabel,
  header,
}: {
  items: ComboboxPopupItem[];
  emptyLabel?: string;
  header?: React.ReactNode;
}) {
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<ComboboxPopupHandle | null>(null);

  function toggle() {
    if (anchorRect) {
      setAnchorRect(null);
    } else {
      const rect = buttonRef.current?.getBoundingClientRect() ?? null;
      if (rect) setAnchorRect(new DOMRect(rect.left, rect.bottom, rect.width, 0));
    }
  }

  useEffect(() => {
    if (!anchorRect) return;
    function handleKey(e: KeyboardEvent) {
      const consumed = popupRef.current?.onKeyDown(e);
      if (consumed) e.preventDefault();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [anchorRect]);

  return (
    <div
      className={sx({
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: tokens.space.step2,
      })}
    >
      <Button ref={buttonRef} variant="ghost" size="xs" onClick={toggle}>
        {anchorRect ? 'Close popup' : 'Open popup'}
      </Button>
      <p
        className={cx(
          sx({
            fontSize: tokens.typography.size.xs,
            color: tokens.foreground.muted,
          })
        )}
      >
        {anchorRect ? 'Arrow keys to navigate, Enter to select, Esc to dismiss' : ''}
      </p>
      <ComboboxPopup
        ref={popupRef}
        items={items}
        anchorRect={anchorRect}
        onSelect={(item) => {
          alert(`Selected: ${item.label}`);
          setAnchorRect(null);
        }}
        emptyLabel={emptyLabel}
        header={header}
      />
    </div>
  );
}

export const FileItems: Story = {
  render: () => <AnchoredPopup items={FILE_ITEMS} />,
};

export const MixedKinds: Story = {
  render: () => <AnchoredPopup items={MIXED_ITEMS} />,
};

export const WithHeader: Story = {
  render: () => (
    <AnchoredPopup
      items={FILE_ITEMS.slice(0, 3)}
      header={<span className={cx(sx({ color: tokens.foreground.default }))}>Context files</span>}
    />
  ),
};

export const EmptyState: Story = {
  render: () => <AnchoredPopup items={[]} emptyLabel="No matches found" />,
};
