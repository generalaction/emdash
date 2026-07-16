import { useDraggable } from '@dnd-kit/core';
import { ScriptStatus, type ScriptStatusKind } from '@emdash/ui/react/components';
import { ChevronDown, Pause, Play, Plus, Terminal, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  type LifecycleScriptStatus,
  type LifecycleScriptsStore,
} from '@renderer/features/tasks/stores/lifecycle-scripts';
import { type TerminalTabViewStore } from '@renderer/features/tasks/terminals/terminal-tab-view-store';
import { TerminalShellOptionLabel } from '@renderer/lib/components/terminal-shell-option-label';
import { Button } from '@renderer/lib/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { PanelTabs } from '@renderer/lib/ui/panel-tabs';
import { BoundShortcut } from '@renderer/lib/ui/shortcut';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';
import type {
  TerminalShellAvailability,
  TerminalShellId,
} from '@shared/core/terminals/terminal-settings';
import { TERMINAL_DRAWER_DRAG_TYPE, type TerminalDrawerDragData } from './terminal-drag';

export type TerminalDrawerMode = 'terminals' | 'scripts';

interface TerminalDrawerTabBarProps {
  mode: TerminalDrawerMode;
  onModeChange: (mode: TerminalDrawerMode) => void;
  lifecycleScriptsMgr: LifecycleScriptsStore | null;
  activeScriptId: string | undefined;
  onSelectScript: (id: string) => void;
  onRunScript: (id: string) => void;
  onStopScript: (id: string) => void;
  terminalTabView: TerminalTabViewStore;
  activeTerminalId: string | undefined;
  shellAvailability: TerminalShellAvailability[];
  onShellMenuOpen: () => void;
  onSelectTerminal: (id: string) => void;
  onAddTerminal: (shell?: TerminalShellId) => void;
  onRemoveTerminal: (id: string) => void;
  onRenameTerminal: (id: string, name: string) => void;
  onHoverTerminal?: (id: string) => void;
  className?: string;
}

const SCRIPT_STATUS_MAP: Record<LifecycleScriptStatus, ScriptStatusKind> = {
  idle: 'waiting',
  pending: 'waiting',
  running: 'in-progress',
  succeeded: 'success',
  failed: 'error',
};

export const TerminalDrawerTabBar = observer(function TerminalDrawerTabBar({
  mode,
  onModeChange,
  lifecycleScriptsMgr,
  activeScriptId,
  onSelectScript,
  onRunScript,
  onStopScript,
  terminalTabView,
  activeTerminalId,
  shellAvailability,
  onShellMenuOpen,
  onSelectTerminal,
  onAddTerminal,
  onRemoveTerminal,
  onRenameTerminal,
  onHoverTerminal,
  className,
}: TerminalDrawerTabBarProps) {
  const scripts = lifecycleScriptsMgr?.tabs ?? [];
  const terminals = terminalTabView.tabs;

  return (
    <div
      className={cn(
        'flex h-9 shrink-0 items-center gap-1 overflow-hidden bg-background px-2 py-2 text-sm',
        className
      )}
    >
      <div
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
        role="tablist"
        aria-label={mode === 'terminals' ? 'Terminals' : 'Scripts'}
      >
        {mode === 'terminals' ? (
          <>
            {terminals.map((terminal) => (
              <DrawerItemTab
                key={terminal.data.id}
                id={`terminal-drawer-${terminal.data.id}`}
                icon={<Terminal className="size-3" />}
                label={terminal.data.name}
                isActive={activeTerminalId === terminal.data.id}
                dragData={{
                  type: TERMINAL_DRAWER_DRAG_TYPE,
                  terminalId: terminal.data.id,
                  label: terminal.data.name,
                }}
                onSelect={() => onSelectTerminal(terminal.data.id)}
                onRename={(name) => onRenameTerminal(terminal.data.id, name)}
                onHover={onHoverTerminal ? () => onHoverTerminal(terminal.data.id) : undefined}
                action={
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <button
                          type="button"
                          aria-label={`Close ${terminal.data.name}`}
                          className="mr-1 flex size-4 shrink-0 items-center justify-center rounded text-foreground-muted opacity-0 group-hover:opacity-100 hover:bg-background hover:text-foreground focus-visible:opacity-100"
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation();
                            onRemoveTerminal(terminal.data.id);
                          }}
                        />
                      }
                    >
                      <X className="size-3" />
                    </TooltipTrigger>
                    <TooltipContent>Close terminal</TooltipContent>
                  </Tooltip>
                }
              />
            ))}
            <NewTerminalButton
              shellAvailability={shellAvailability}
              onShellMenuOpen={onShellMenuOpen}
              onAddTerminal={onAddTerminal}
            />
          </>
        ) : (
          scripts.map((script) => (
            <DrawerItemTab
              key={script.data.id}
              id={`script-drawer-${script.data.id}`}
              icon={<ScriptStatus status={SCRIPT_STATUS_MAP[script.status]} size={12} />}
              label={script.data.label}
              isActive={activeScriptId === script.data.id}
              onSelect={() => onSelectScript(script.data.id)}
              iconAction={
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        aria-label={
                          script.isRunning
                            ? `Stop ${script.data.label} script`
                            : `Run ${script.data.label} script`
                        }
                        className="flex size-3 items-center justify-center text-foreground-muted hover:text-foreground"
                        onClick={(event) => {
                          event.stopPropagation();
                          if (script.isRunning) {
                            onStopScript(script.data.id);
                          } else {
                            onRunScript(script.data.id);
                          }
                        }}
                      />
                    }
                  >
                    {script.isRunning ? <Pause className="size-3" /> : <Play className="size-3" />}
                  </TooltipTrigger>
                  <TooltipContent>{script.isRunning ? 'Stop' : 'Run'}</TooltipContent>
                </Tooltip>
              }
            />
          ))
        )}
      </div>
      <div className="mx-1 h-4 w-px shrink-0 bg-border" aria-hidden="true" />
      <PanelTabs
        compact
        value={mode}
        onChange={onModeChange}
        tabs={[
          { value: 'terminals', label: 'Terminals' },
          { value: 'scripts', label: 'Scripts' },
        ]}
      />
    </div>
  );
});

function NewTerminalButton({
  shellAvailability,
  onShellMenuOpen,
  onAddTerminal,
}: {
  shellAvailability: TerminalShellAvailability[];
  onShellMenuOpen: () => void;
  onAddTerminal: (shell?: TerminalShellId) => void;
}) {
  return (
    <div className="flex shrink-0 items-center">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              className="size-6 rounded-r-none px-0"
              aria-label="New terminal"
              onClick={() => onAddTerminal()}
            />
          }
        >
          <Plus className="size-3" />
        </TooltipTrigger>
        <TooltipContent>
          New terminal <BoundShortcut settingsKey="newTerminal" variant="keycaps" />
        </TooltipContent>
      </Tooltip>
      <DropdownMenu onOpenChange={(open) => open && onShellMenuOpen()}>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              className="size-6 rounded-l-none px-0"
              aria-label="New terminal with shell"
            />
          }
        >
          <ChevronDown className="size-3" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {shellAvailability.map((entry) => (
            <DropdownMenuItem
              key={entry.id}
              disabled={!entry.available}
              title={entry.reason}
              onClick={() => onAddTerminal(entry.id)}
            >
              <TerminalShellOptionLabel entry={entry} />
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

interface DrawerItemTabProps {
  id: string;
  icon: ReactNode;
  label: string;
  isActive: boolean;
  onSelect: () => void;
  onRename?: (name: string) => void;
  onHover?: () => void;
  iconAction?: ReactNode;
  action?: ReactNode;
  dragData?: TerminalDrawerDragData;
}

function DrawerItemTab({
  id,
  icon,
  label,
  isActive,
  onSelect,
  onRename,
  onHover,
  iconAction,
  action,
  dragData,
}: DrawerItemTabProps) {
  const [isEditing, setIsEditing] = useState(false);
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({
    id,
    data: dragData,
    disabled: !dragData,
  });

  return (
    <div
      ref={setDragRef}
      className={cn(
        'group relative flex h-6 max-w-48 shrink-0 items-center rounded-lg text-xs transition-colors',
        isActive
          ? 'bg-background-2 text-foreground'
          : 'text-foreground-muted hover:bg-background-2 hover:text-foreground',
        isDragging && 'opacity-50'
      )}
    >
      {isEditing && onRename ? (
        <div className="flex min-w-0 flex-1 items-center gap-1.5 px-2">
          <span className="shrink-0">{icon}</span>
          <InlineRenameInput
            initialValue={label}
            onConfirm={(name) => {
              setIsEditing(false);
              if (name && name !== label) onRename(name);
            }}
            onCancel={() => setIsEditing(false)}
          />
        </div>
      ) : (
        <button
          type="button"
          {...attributes}
          {...listeners}
          role="tab"
          aria-selected={isActive}
          className={cn(
            'flex h-full min-w-0 flex-1 items-center gap-1.5 px-2 outline-none',
            dragData && 'cursor-grab active:cursor-grabbing'
          )}
          onClick={onSelect}
          onMouseEnter={onHover}
          onDoubleClick={(event) => {
            if (!onRename) return;
            event.stopPropagation();
            setIsEditing(true);
          }}
        >
          <span
            className={cn(
              'shrink-0 transition-opacity',
              iconAction && 'group-hover:opacity-0 group-focus-within:opacity-0'
            )}
          >
            {icon}
          </span>
          <span className="truncate">{label}</span>
        </button>
      )}
      {!isEditing && iconAction && (
        <span className="absolute top-1/2 left-2 z-10 flex size-3 -translate-y-1/2 items-center justify-center opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
          {iconAction}
        </span>
      )}
      {!isEditing && action}
    </div>
  );
}

function InlineRenameInput({
  initialValue,
  onConfirm,
  onCancel,
}: {
  initialValue: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  return (
    <input
      ref={ref}
      className="min-w-0 flex-1 rounded border border-border bg-transparent px-1 py-0.5 text-xs text-foreground outline-none"
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => onConfirm(value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onConfirm(value);
        if (event.key === 'Escape') onCancel();
        event.stopPropagation();
      }}
      onClick={(event) => event.stopPropagation()}
    />
  );
}
