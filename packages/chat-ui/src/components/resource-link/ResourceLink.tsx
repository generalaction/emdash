/**
 * ResourceLink — single-line renderer for ChatResourceLink rows.
 *
 * Layout (fixed single-line row, no background):
 *   [resource || fileIcon] title path
 *
 * The icon is the file-type devicon when resolvable, else a generic resource
 * glyph. Title and path sit inline; the path keeps the muted secondary styling.
 *
 * Click: workspace-file targets open in the editor via onOpenFile.
 *        external targets follow the URI in a new tab.
 *        opaque targets do nothing (URI is shown for copy).
 *
 * Outer geometry (height) is applied by resource-link.def.tsx Render.
 */

import { Show } from 'solid-js';
import { resolveFileIconClass } from '../../lib/file-icons';
import type { ChatResourceLink, ResourceTarget } from '../../model';
import { useCommands } from '../CommandsContext';
import { GenericFileIcon } from '../primitives/icons';

// ── Secondary label ─────────────────────────────────────────────────────────

function secondaryLabel(uri: string, target: ResourceTarget): string {
  if (target.kind === 'workspace-file') {
    return target.path;
  }
  if (target.kind === 'external') {
    try {
      return new URL(target.url).hostname;
    } catch {
      return target.url;
    }
  }
  // opaque: show the scheme or the raw uri, capped
  const colon = uri.indexOf(':');
  return colon > 0 ? uri.slice(0, colon + 1) + '//' + '…' : uri;
}

// ── Size formatting ─────────────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Component ────────────────────────────────────────────────────────────────

export type ResourceLinkProps = {
  item: ChatResourceLink;
};

export function ResourceLink(props: ResourceLinkProps) {
  const commands = useCommands();

  const displayName = () => props.item.title ?? props.item.name;
  const iconName = () => {
    const name = props.item.name;
    return resolveFileIconClass(name) ?? null;
  };
  const secondary = () => secondaryLabel(props.item.uri, props.item.target);
  const isClickable = () => props.item.target.kind !== 'opaque';

  const handleClick = () => {
    const target = props.item.target;
    if (target.kind === 'workspace-file') {
      commands().onOpenFile?.({
        path: target.path,
        itemId: props.item.id,
        source: 'resource-link',
      });
    } else if (target.kind === 'external') {
      window.open(target.url, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div
      class="flex items-center gap-2 text-sm"
      classList={{
        'cursor-pointer hover:text-chat-fg transition-colors flex items-center gap-2 p-2 rounded-lg border border-chat-border w-full hover:bg-chat-bg-2':
          isClickable(),
      }}
      style={{ height: '100%' }}
      onClick={isClickable() ? handleClick : undefined}
      role={isClickable() ? 'button' : undefined}
    >
      {/* [resource || fileIcon] */}
      <div class="text-chat-fg-muted shrink-0">
        <Show when={iconName()} fallback={<GenericFileIcon />}>
          <span class={iconName()!} />
        </Show>
      </div>

      {/* title */}
      <span class="text-chat-fg-body shrink-0 truncate">{displayName()}</span>

      {/* path — muted secondary styling */}
      <span class="text-chat-fg-muted min-w-0 truncate text-xs">{secondary()}</span>

      {/* optional size badge */}
      <Show when={props.item.size !== undefined}>
        <span class="text-chat-fg-muted shrink-0 text-xs font-normal">
          {formatSize(props.item.size!)}
        </span>
      </Show>
    </div>
  );
}
