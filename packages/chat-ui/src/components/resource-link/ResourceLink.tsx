/**
 * ResourceLink — card renderer for ChatResourceLink rows.
 *
 * Layout (fixed 2-line card):
 *   Line 1: file icon · title (or name) · optional size badge
 *   Line 2: secondary label derived from target (path / host / "custom resource")
 *
 * Click: workspace-file targets open in the editor via onOpenFile.
 *        external targets follow the URI in a new tab.
 *        opaque targets do nothing (URI is shown for copy).
 *
 * Outer geometry (height, padding) is applied by resource-link.def.tsx Render.
 */

import { resolveFileIconClass } from '@emdash/ui/primitives';
import { Show } from 'solid-js';
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
      class="flex items-center gap-2.5 rounded-md border border-border bg-background-2 px-3 text-sm"
      classList={{
        'cursor-pointer hover:bg-background-3 transition-colors': isClickable(),
      }}
      style={{ height: '100%' }}
      onClick={isClickable() ? handleClick : undefined}
      role={isClickable() ? 'button' : undefined}
    >
      {/* Icon */}
      <div class="shrink-0 text-foreground-muted">
        <Show when={iconName()} fallback={<GenericFileIcon />}>
          <span class={iconName()!} />
        </Show>
      </div>

      {/* Main content */}
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2 truncate font-medium text-foreground-body">
          <span class="truncate">{displayName()}</span>
          <Show when={props.item.size !== undefined}>
            <span class="shrink-0 text-xs font-normal text-foreground-muted">
              {formatSize(props.item.size!)}
            </span>
          </Show>
        </div>
        <div class="mt-0.5 truncate text-xs text-foreground-muted">{secondary()}</div>
      </div>
    </div>
  );
}
