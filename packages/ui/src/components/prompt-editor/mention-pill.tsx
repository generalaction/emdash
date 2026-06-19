/**
 * MentionPill
 *
 * React NodeView for the TipTap `mention` atom node. Renders as an inline pill:
 *
 *   [icon] [name]
 *
 * On hover, a small ✕ button appears over the icon so the user can remove the
 * mention without keyboard navigation. The pill is `contentEditable=false`, so
 * Backspace / Delete at the node boundary deletes the entire atom at once.
 */

import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { AtSign, Braces, CircleDot, File, X } from 'lucide-react';
import React from 'react';
import { cn } from '../../lib/cn';
import type { MentionKind } from './types';
import { basename, fileIconClass } from './mention-pill-helpers';

// ── Kind → fallback lucide icon ───────────────────────────────────────────────

const KIND_ICONS: Record<MentionKind, React.ReactNode> = {
  file: <File className="size-3" />,
  issue: <CircleDot className="size-3" />,
  symbol: <Braces className="size-3" />,
  custom: <AtSign className="size-3" />,
};

function PillIcon({ kind, label }: { kind: MentionKind; label: string }) {
  if (kind === 'file') {
    const cls = fileIconClass(label);
    if (cls) return <i className={cn(cls, 'text-[12px] leading-none')} />;
  }
  return KIND_ICONS[kind] ?? KIND_ICONS.custom;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function MentionPill({ node, deleteNode }: NodeViewProps) {
  const label = (node.attrs.label as string | null) ?? (node.attrs.id as string | null) ?? '';
  const rawName = (node.attrs.name as string | null) ?? null;
  const name = rawName ?? (basename(label) || label);
  const kind = ((node.attrs.kind as string | null) ?? 'custom') as MentionKind;

  return (
    <NodeViewWrapper as="span" className="mention-pill-wrapper inline-block align-baseline">
      {/* The outer span is `group` so the hover-x can be revealed via group-hover. */}
      <span
        contentEditable={false}
        className={cn(
          'group relative inline-flex cursor-default select-none items-center gap-1',
          'rounded-sm bg-surface-hover px-1 py-0.5',
          'text-xs font-medium text-foreground',
          'ring-1 ring-foreground/10',
          'align-baseline',
        )}
        data-mention-id={node.attrs.id as string}
        data-mention-kind={kind}
      >
        {/* Icon area — relative so the ✕ overlay is positioned inside it */}
        <span className="relative flex size-3.5 shrink-0 items-center justify-center">
          <PillIcon kind={kind} label={label} />
          {/* Hover-x: overlaid over the icon on group-hover */}
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              deleteNode();
            }}
            aria-label={`Remove @${name}`}
            className={cn(
              'absolute inset-0 flex items-center justify-center rounded-sm',
              'bg-surface-hover opacity-0 transition-opacity group-hover:opacity-100',
              'hover:bg-surface-selected',
            )}
          >
            <X className="size-2.5" />
          </button>
        </span>
        {/* Display name */}
        <span className="max-w-[200px] truncate">{name}</span>
      </span>
    </NodeViewWrapper>
  );
}
