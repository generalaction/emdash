import { observer } from 'mobx-react-lite';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  TabCommand,
  TabHost,
  TabViewContext,
  ResolvedTab,
} from '@renderer/features/tabs/core/tab-provider';
import { TabCloseButton } from './tab-close-button';
import { TabContextMenu } from './tab-context-menu';
import { TabDragPreviewShell, TabItemShell } from './tab-item-shell';
import { TabTitle } from './tab-title';

export interface GenericTabItemProps {
  tab: ResolvedTab;
  host: TabHost;
  ctx: TabViewContext;
  /** Plain visible text; used as the default tooltip base and rename commit basis. */
  label: string;
  /** Tooltip base when different from label (e.g. full file path); preview hint appended. */
  tooltip?: string;
  /** Leading icon slot (file icon, agent icon, spinner). */
  preSlot?: ReactNode;
  /**
   * Overrides the default `<TabTitle>{label}</TabTitle>` for non-rename custom labels
   * (e.g. diff muted suffix). While editing, the inline input is shown regardless.
   */
  labelSlot?: ReactNode;
  /** Content shown under the absolutely-positioned close X (e.g. dirty dot, status icon). */
  statusSlot?: ReactNode;
  /** Renders the title in destructive color. */
  hasError?: boolean;
  /** Extra context-menu items placed after the engine commands. */
  kindCommands?: TabCommand[];
  /** Raw editable text prefilled into the rename input (defaults to label). */
  renameValue?: string;
  /** Max character length enforced on the rename input. */
  renameMaxLength?: number;
}

/**
 * Single generic tab chip renderer. Wraps TabContextMenu + TabItemShell and owns:
 * - Preview tooltip/italic formatting
 * - Inline rename (label → input) driven by host.renameRequest
 * - Close button with optional status indicator underneath
 *
 * Each tab kind supplies only its slot config (preSlot, labelSlot, statusSlot,
 * kindCommands) plus label/tooltip/hasError.
 */
export const GenericTabItem = observer(function GenericTabItem({
  tab,
  host,
  ctx,
  label,
  tooltip,
  preSlot,
  labelSlot,
  statusSlot,
  hasError,
  kindCommands,
  renameValue,
  renameMaxLength,
}: GenericTabItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const committedRef = useRef(false);

  const startRename = useCallback(() => {
    committedRef.current = false;
    window.setTimeout(() => setIsEditing(true), 0);
  }, []);

  const renameRequested = host.renameRequest?.tabId === tab.tabId;
  useEffect(() => {
    if (!renameRequested) return;
    startRename();
    host.clearRenameRequest();
  }, [renameRequested, startRename, host]);

  const commit = useCallback(
    (value: string) => {
      if (committedRef.current) return;
      committedRef.current = true;
      let next = value.trim();
      if (renameMaxLength != null) next = next.slice(0, renameMaxLength);
      if (next && next !== (renameValue ?? label)) host.commitRename(tab.tabId, next);
      setIsEditing(false);
    },
    [host, label, renameMaxLength, renameValue, tab.tabId]
  );

  const base = tooltip ?? label;
  const fullTitle = tab.isPreview ? `${base} (preview — double-click to keep)` : base;

  return (
    <TabContextMenu tab={tab} host={host} ctx={ctx} kindCommands={kindCommands}>
      <TabItemShell
        tabId={tab.tabId}
        isActive={tab.isActive}
        title={fullTitle}
        onSelect={() => host.setActiveTab(tab.tabId)}
        onPin={() => host.pin(tab.tabId)}
        onClose={() => host.requestCloseTab(tab.tabId)}
      >
        {preSlot}
        {isEditing ? (
          <input
            ref={(el) => {
              el?.focus();
              el?.select();
            }}
            defaultValue={renameValue ?? label}
            maxLength={renameMaxLength}
            className=" min-w-0 rounded bg-background-1 max-w-30 h-6 px-1.5 text-sm text-foreground ring-1 ring-foreground/20 outline-none focus:ring-foreground/40"
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') commit(e.currentTarget.value);
              else if (e.key === 'Escape') {
                committedRef.current = true;
                setIsEditing(false);
              }
            }}
          />
        ) : (
          (labelSlot ?? (
            <TabTitle isActive={tab.isActive} isPreview={tab.isPreview} hasError={hasError} className="px-1.5">
              {label}
            </TabTitle>
          ))
        )}
        <TabCloseButton
          onClose={() => host.requestCloseTab(tab.tabId)}
          ariaLabel={`Close ${label}`}
          statusIndicator={statusSlot}
        />
      </TabItemShell>
    </TabContextMenu>
  );
});

/**
 * Generic drag ghost for any tab kind. Replaces the four per-kind DragPreview bodies.
 */
export function GenericTabDragPreview({ preSlot, label }: { preSlot?: ReactNode; label: string }) {
  return (
    <TabDragPreviewShell>
      {preSlot}
      <span className="max-w-[200px] truncate">{label}</span>
    </TabDragPreviewShell>
  );
}
