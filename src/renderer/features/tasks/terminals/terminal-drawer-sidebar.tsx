import { Pause, Play, Plus, Settings, Terminal, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { type LifecycleScriptsStore } from '@renderer/features/tasks/stores/lifecycle-scripts';
import { type TerminalTabViewStore } from '@renderer/features/tasks/terminals/terminal-tab-view-store';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { MicroLabel } from '@renderer/lib/ui/label';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';
import { scriptIcon } from './terminal-tabs';

interface TerminalDrawerSidebarProps {
  lifecycleScriptsMgr: LifecycleScriptsStore | null;
  activeScriptId: string | undefined;
  onSelectScript: (id: string) => void;
  onRunScript: () => void;
  onStopScript: () => void;
  terminalTabView: TerminalTabViewStore;
  activeTerminalId: string | undefined;
  onSelectTerminal: (id: string) => void;
  onAddTerminal: () => void;
  onRemoveTerminal: (id: string) => void;
  onRenameTerminal: (id: string, name: string) => void;
  projectId: string;
  className?: string;
}

export const TerminalDrawerSidebar = observer(function TerminalDrawerSidebar({
  lifecycleScriptsMgr,
  activeScriptId,
  onSelectScript,
  onRunScript,
  onStopScript,
  terminalTabView,
  activeTerminalId,
  onSelectTerminal,
  onAddTerminal,
  onRemoveTerminal,
  onRenameTerminal,
  projectId,
  className,
}: TerminalDrawerSidebarProps) {
  const scripts = lifecycleScriptsMgr?.tabs ?? [];
  const terminals = terminalTabView.tabs;

  const { navigate } = useNavigate();

  return (
    <div className={cn('flex flex-col overflow-y-auto text-sm', className)}>
      <Section
        label="Terminals"
        action={
          <Tooltip>
            <TooltipTrigger>
              <button
                className="flex items-center justify-center size-5 rounded hover:bg-background-2 text-foreground-muted hover:text-foreground"
                onClick={onAddTerminal}
              >
                <Plus className="size-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent>New terminal</TooltipContent>
          </Tooltip>
        }
      >
        {terminals.map((terminal) => (
          <SidebarRow
            key={terminal.data.id}
            icon={<Terminal className="size-3" />}
            label={terminal.data.name}
            isActive={activeTerminalId === terminal.data.id}
            onSelect={() => onSelectTerminal(terminal.data.id)}
            onRename={(name) => onRenameTerminal(terminal.data.id, name)}
            action={
              <Tooltip>
                <TooltipTrigger>
                  <button
                    className="ml-1 shrink-0 flex items-center justify-center size-5 rounded opacity-0 group-hover:opacity-100 hover:bg-background text-foreground-muted hover:text-foreground"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveTerminal(terminal.data.id);
                    }}
                  >
                    <X className="size-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Close terminal</TooltipContent>
              </Tooltip>
            }
          />
        ))}
      </Section>
      {scripts.length > 0 && lifecycleScriptsMgr && (
        <Section
          label="Scripts"
          action={
            <Tooltip>
              <TooltipTrigger>
                <button
                  onClick={() => navigate('project', { projectId })}
                  className="flex items-center justify-center size-5 rounded hover:bg-background-2 text-foreground-muted hover:text-foreground"
                >
                  <Settings className="size-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Configure in project settings</TooltipContent>
            </Tooltip>
          }
        >
          {scripts.map((script) => {
            const isActive = activeScriptId === script.data.id;
            return (
              <SidebarRow
                key={script.data.id}
                icon={scriptIcon(script.data.type)}
                label={script.data.label}
                isActive={isActive}
                onSelect={() => onSelectScript(script.data.id)}
                action={
                  isActive ? (
                    <Tooltip>
                      <TooltipTrigger>
                        <button
                          className="ml-1 shrink-0 flex items-center justify-center size-5 rounded hover:bg-background text-foreground-muted hover:text-foreground"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (script.isRunning) {
                              onStopScript();
                            } else {
                              onRunScript();
                            }
                          }}
                        >
                          {script.isRunning ? (
                            <Pause className="size-3" />
                          ) : (
                            <Play className="size-3" />
                          )}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>{script.isRunning ? 'Stop' : 'Run'}</TooltipContent>
                    </Tooltip>
                  ) : null
                }
              />
            );
          })}
        </Section>
      )}
    </div>
  );
});

interface SidebarRowProps {
  icon?: ReactNode;
  label: string;
  isActive: boolean;
  onSelect: () => void;
  onRename?: (name: string) => void;
  action?: ReactNode;
}

function SidebarRow({ icon, label, isActive, onSelect, onRename, action }: SidebarRowProps) {
  const [isEditing, setIsEditing] = useState(false);

  if (isEditing && onRename) {
    return (
      <div
        className={cn(
          'group flex items-center gap-1.5 px-3 py-1 rounded-md',
          isActive && 'bg-background-2'
        )}
      >
        {icon && <span className="shrink-0 text-foreground-muted">{icon}</span>}
        <InlineRenameInput
          initialValue={label}
          onConfirm={(name) => {
            setIsEditing(false);
            if (name && name !== label) onRename(name);
          }}
          onCancel={() => setIsEditing(false)}
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        'group flex items-center justify-between px-3 py-1.5 cursor-pointer hover:bg-background-2 rounded-md',
        isActive && 'bg-background-2 text-foreground'
      )}
      onClick={onSelect}
      onDoubleClick={(e) => {
        if (!onRename) return;
        e.stopPropagation();
        setIsEditing(true);
      }}
    >
      <span
        className={cn(
          'flex items-center gap-1.5 min-w-0 truncate text-foreground-muted',
          isActive && 'text-foreground'
        )}
      >
        {icon && <span className="shrink-0">{icon}</span>}
        <span className="truncate">{label}</span>
      </span>
      {action}
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
      className="w-full bg-transparent outline-none text-sm border border-border px-1 py-0.5 rounded text-foreground"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onConfirm(value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onConfirm(value);
        if (e.key === 'Escape') onCancel();
        e.stopPropagation();
      }}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

function Section({
  label,
  action,
  children,
}: {
  label: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-4 pt-4">
        <MicroLabel>{label}</MicroLabel>
        {action}
      </div>
      <div className="flex flex-col gap-0.5 p-2">{children}</div>
    </div>
  );
}
