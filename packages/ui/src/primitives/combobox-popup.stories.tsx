/**
 * ComboboxPopup — standalone stories for the floating listbox primitive.
 *
 * Since ComboboxPopup anchors itself to a DOMRect, each story wraps it in a
 * button that supplies its own bounding rect as the anchor. Keyboard events
 * are forwarded through the imperative handle.
 */

import type { Meta, StoryObj } from '@storybook/react-vite';
import { AtSign, Braces, CircleDot, File } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { Button } from './button';
import {
  ComboboxPopup,
  type ComboboxPopupHandle,
  type ComboboxPopupItem,
} from './combobox-popup';

const meta: Meta = {
  title: 'Primitives/ComboboxPopup',
  parameters: { layout: 'centered' },
};
export default meta;
type Story = StoryObj;

// ── Shared sample data ────────────────────────────────────────────────────────

const FILE_ITEMS: ComboboxPopupItem[] = [
  {
    id: 'src/components/chat-composer.tsx',
    icon: <i className="devicon-react-original colored text-[13px]" />,
    label: 'chat-composer.tsx',
    description: 'src/components',
  },
  {
    id: 'src/lib/file-icons.ts',
    icon: <i className="devicon-typescript-plain colored text-[13px]" />,
    label: 'file-icons.ts',
    description: 'src/lib',
  },
  {
    id: 'package.json',
    icon: <i className="devicon-npm-original-wordmark colored text-[13px]" />,
    label: 'package.json',
    description: '',
  },
  {
    id: 'README.md',
    icon: <i className="devicon-markdown-original text-[13px]" />,
    label: 'README.md',
    description: '',
  },
];

const MIXED_ITEMS: ComboboxPopupItem[] = [
  { id: 'f1', icon: <File className="size-3.5" />, label: 'src/utils.ts', description: 'file' },
  { id: 'i1', icon: <CircleDot className="size-3.5" />, label: 'Issue #42', description: 'issue' },
  { id: 's1', icon: <Braces className="size-3.5" />, label: 'handleSubmit', description: 'symbol' },
  { id: 'c1', icon: <AtSign className="size-3.5" />, label: 'custom item', description: 'custom' },
];

// ── Wrapper that anchors the popup to a button ────────────────────────────────

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

  // Forward keyboard events to the popup handle.
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
    <div className="flex flex-col items-center gap-2">
      <Button ref={buttonRef} variant="ghost" size="sm" onClick={toggle}>
        {anchorRect ? 'Close popup' : 'Open popup'}
      </Button>
      <p className="text-xs text-foreground-muted">
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

// ── Stories ───────────────────────────────────────────────────────────────────

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
      header={<span className="font-medium text-foreground">Context files</span>}
    />
  ),
};

export const EmptyState: Story = {
  render: () => <AnchoredPopup items={[]} emptyLabel="No matches found" />,
};
