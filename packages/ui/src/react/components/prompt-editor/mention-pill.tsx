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

import { cx } from '@styles/index';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { AtSign, Braces, CircleDot, File, X } from 'lucide-react';
import React from 'react';
import { Icon, IconSlot } from '../../primitives/icon';
import { Devicon } from '../devicon/devicon';
import { basename, fileIconClass } from './mention-pill-helpers';
import type { MentionKind, RenderMentionIcon } from './types';
import * as styles from './mention-pill.css';

// ── Kind → fallback lucide icon ───────────────────────────────────────────────

const KIND_ICONS: Record<MentionKind, React.ReactNode> = {
  file: <Icon source={File} size="xs" />,
  issue: <Icon source={CircleDot} size="xs" />,
  symbol: <Icon source={Braces} size="xs" />,
  custom: <Icon source={AtSign} size="xs" />,
};

function PillIcon({
  id,
  kind,
  label,
  renderMentionIcon,
}: {
  id: string;
  kind: MentionKind;
  label: string;
  renderMentionIcon?: RenderMentionIcon;
}) {
  const hostIcon = renderMentionIcon?.({ id, label, kind });
  if (hostIcon) return hostIcon;

  if (kind === 'file') {
    const cls = fileIconClass(label);
    if (cls) return <Devicon iconClass={cls} size={12} />;
  }
  return KIND_ICONS[kind] ?? KIND_ICONS.custom;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function MentionPill({
  node,
  deleteNode,
  renderMentionIcon,
}: NodeViewProps & { renderMentionIcon?: RenderMentionIcon }) {
  const id = (node.attrs.id as string | null) ?? '';
  const label = (node.attrs.label as string | null) ?? (node.attrs.id as string | null) ?? '';
  const rawName = (node.attrs.name as string | null) ?? null;
  const name = rawName ?? (basename(label) || label);
  const kind = ((node.attrs.kind as string | null) ?? 'custom') as MentionKind;
  const pending = node.attrs.pending === true;

  return (
    <NodeViewWrapper as="span" className={cx('mention-pill-wrapper', styles.pillWrapper)}>
      <span
        contentEditable={false}
        className={cx(styles.pill, pending && styles.pillPending)}
        data-mention-id={node.attrs.id as string}
        data-mention-kind={kind}
        data-mention-pending={pending || undefined}
      >
        {/* Icon area — relative so the ✕ overlay is positioned inside it */}
        <span className={styles.pillIconArea}>
          <IconSlot size="xs">
            <PillIcon id={id} kind={kind} label={label} renderMentionIcon={renderMentionIcon} />
          </IconSlot>
          {/* Hover-x: overlaid over the icon on pill-hover */}
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              deleteNode();
            }}
            aria-label={`Remove @${name}`}
            className={styles.pillRemoveBtn}
          >
            <Icon source={X} />
          </button>
        </span>
        {/* Display name */}
        <span className={styles.pillName}>{name}</span>
      </span>
    </NodeViewWrapper>
  );
}
