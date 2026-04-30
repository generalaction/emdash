import { History, MoreHorizontal, Pencil, Play, Trash2, User } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ActionSpec } from '@shared/automations/actions';
import type { Automation } from '@shared/automations/types';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { useAccountSession } from '@renderer/lib/hooks/useAccount';
import { useGithubContext } from '@renderer/lib/providers/github-context-provider';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { agentConfig } from '@renderer/utils/agentConfig';

type Tool = {
  id: string;
  label: string;
  logo: string;
  isSvg?: boolean;
  invertInDark?: boolean;
};

function actionTool(action: ActionSpec): Tool | null {
  const cfg = action.provider ? agentConfig[action.provider] : undefined;
  if (!cfg) return null;
  return {
    id: `agent:${action.provider}`,
    label: cfg.name,
    logo: cfg.logo,
    isSvg: cfg.isSvg,
    invertInDark: cfg.invertInDark,
  };
}

function collectTools(automation: Automation): Tool[] {
  const seen = new Set<string>();
  const tools: Tool[] = [];
  for (const action of automation.actions) {
    const tool = actionTool(action);
    if (!tool || seen.has(tool.id)) continue;
    seen.add(tool.id);
    tools.push(tool);
  }
  return tools;
}

interface AutomationRowProps {
  automation: Automation;
  busy?: boolean;
  onEdit: (automation: Automation) => void;
  onDelete: (automation: Automation) => void;
  onRunNow: (automation: Automation) => void;
  onSetEnabled: (automation: Automation, enabled: boolean) => void;
  onShowRuns: (automation: Automation) => void;
}

export const AutomationRow = observer(function AutomationRow({
  automation,
  busy,
  onEdit,
  onDelete,
  onRunNow,
  onSetEnabled,
  onShowRuns,
}: AutomationRowProps) {
  const { data: session } = useAccountSession();
  const { user: githubUser } = useGithubContext();
  const author = session?.user
    ? { name: session.user.username, avatarUrl: session.user.avatarUrl }
    : githubUser
      ? { name: githubUser.login, avatarUrl: githubUser.avatar_url }
      : null;

  const tools = useMemo(() => collectTools(automation), [automation]);
  const visibleTools = tools.slice(0, 3);
  const overflow = tools.length - visibleTools.length;

  const titleRef = useRef<HTMLButtonElement>(null);
  const [isTitleTruncated, setIsTitleTruncated] = useState(false);

  useLayoutEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    const check = () => setIsTitleTruncated(el.scrollWidth > el.clientWidth);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [automation.name]);

  const dimmed = !automation.enabled;

  return (
    <div
      className={`group grid grid-cols-[minmax(0,1fr)_140px_88px_64px_32px] items-center gap-3 border-b border-border px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-muted/30 ${
        dimmed ? 'opacity-60' : ''
      }`}
    >
      <div className="min-w-0">
        <Tooltip>
          <TooltipTrigger
            ref={titleRef}
            onClick={() => onEdit(automation)}
            className="block w-full max-w-full truncate rounded-sm text-left text-sm font-medium text-foreground hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {automation.name}
          </TooltipTrigger>
          {isTitleTruncated ? <TooltipContent>{automation.name}</TooltipContent> : null}
        </Tooltip>
      </div>

      <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        {author ? (
          <>
            {author.avatarUrl ? (
              <img
                src={author.avatarUrl}
                alt={author.name}
                className="size-5 shrink-0 rounded-full border border-border/60"
              />
            ) : (
              <div className="flex size-5 shrink-0 items-center justify-center rounded-full border border-border/60 bg-muted">
                <User className="size-3 text-muted-foreground" />
              </div>
            )}
            <span className="truncate">{author.name}</span>
          </>
        ) : (
          <span className="text-foreground-passive">—</span>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        {visibleTools.length === 0 ? (
          <span className="text-xs text-foreground-passive">—</span>
        ) : (
          visibleTools.map((tool) => (
            <Tooltip key={tool.id}>
              <TooltipTrigger>
                <span className="flex size-4 items-center justify-center text-muted-foreground">
                  <AgentLogo
                    logo={tool.logo}
                    alt={tool.label}
                    isSvg={tool.isSvg}
                    invertInDark={tool.invertInDark}
                    className="size-4 rounded-sm"
                  />
                </span>
              </TooltipTrigger>
              <TooltipContent>{tool.label}</TooltipContent>
            </Tooltip>
          ))
        )}
        {overflow > 0 && (
          <span className="text-[10px] font-medium text-muted-foreground">+{overflow}</span>
        )}
      </div>

      <div className="text-xs text-muted-foreground">
        <RelativeTime value={automation.createdAt} compact />
      </div>

      <div
        className="flex items-center justify-end"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`Actions for ${automation.name}`}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem disabled={busy} onClick={() => onRunNow(automation)}>
              <Play className="size-3.5" />
              Run now
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onShowRuns(automation)}>
              <History className="size-3.5" />
              Run history
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onEdit(automation)}>
              <Pencil className="size-3.5" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onSetEnabled(automation, !automation.enabled)}>
              {automation.enabled ? 'Disable' : 'Enable'}
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={() => onDelete(automation)}>
              <Trash2 className="size-3.5" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
});
