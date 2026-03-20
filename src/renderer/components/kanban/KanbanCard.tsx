import { AlertCircle } from 'lucide-react';
import React from 'react';
import type { NotificationType } from '@shared/events/agentEvents';
import { useAgent } from '../../core/conversations/AgentProvider';
import { agentAssets } from '../../providers/assets';
import { agentMeta, type UiAgent } from '../../providers/meta';
import type { Task } from '../../types/app';
import AgentLogo from '../AgentLogo';
import { Spinner } from '../ui/spinner';
import AgentTooltip from './AgentTooltip';

function notificationLabel(type: NotificationType): string {
  if (type === 'permission_prompt') return 'Waiting for permission';
  if (type === 'idle_prompt') return 'Waiting for input';
  if (type === 'elicitation_dialog') return 'Agent has a question';
  return 'Needs attention';
}

function resolveAgent(taskId: string): UiAgent | null {
  try {
    const v = localStorage.getItem(`taskAgent:${taskId}`);
    if (!v) return null;
    const id = v.trim() as UiAgent;
    return id in agentAssets ? id : null;
  } catch {
    return null;
  }
}

const KanbanCard: React.FC<{
  ws: Task;
  onOpen?: (ws: Task) => void;
  draggable?: boolean;
}> = ({ ws, onOpen, draggable = true }) => {
  const SHOW_AGENT_LOGOS = false;
  // Resolve single-agent from legacy localStorage (single-agent tasks)
  const agent = resolveAgent(ws.id);
  const asset = agent ? agentAssets[agent] : null;

  // Multi‑agent badges (metadata lists selected agents)
  const multi = ws.metadata?.multiAgent?.enabled ? ws.metadata?.multiAgent : null;
  const agentRuns = (multi?.agentRuns?.map((ar) => ar.agent) ?? []) as UiAgent[];
  const legacyAgents = Array.isArray(multi?.agents) ? (multi?.agents as UiAgent[]) : [];
  const agents = Array.from(new Set([...agentRuns, ...legacyAgents]));
  const adminAgent: UiAgent | null = (multi?.selectedAgent as UiAgent) || null;

  const handleClick = () => onOpen?.(ws);
  const busy = false;
  const { notificationsByTaskId } = useAgent();
  const pendingNotifications = notificationsByTaskId[ws.id] ?? [];
  const needsAttention = pendingNotifications.length > 0;
  const attentionTitle = needsAttention
    ? pendingNotifications.map((n) => notificationLabel(n.type)).join(', ')
    : undefined;

  return (
    <AgentTooltip
      agents={agents.length > 0 ? agents : agent ? [agent] : []}
      adminAgent={adminAgent}
      side="top"
      delay={150}
      taskPath={ws.path}
      taskName={ws.name}
    >
      <div
        role="button"
        tabIndex={0}
        className="rounded-lg border border-border bg-background p-3 shadow-sm transition hover:bg-muted/40 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0"
        draggable={draggable}
        onDragStart={(e) => {
          e.dataTransfer.setData('text/plain', ws.id);
        }}
        onDoubleClick={handleClick}
        onClick={handleClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleClick();
          }
        }}
      >
        <div className="flex w-full items-center justify-between gap-2 overflow-hidden">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-foreground">{ws.name}</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">{ws.branch}</div>
          </div>

          {agents.length > 0 && (SHOW_AGENT_LOGOS || busy || needsAttention) ? (
            <div className="flex shrink-0 items-center gap-1">
              {busy ? <Spinner size="sm" className="shrink-0 text-muted-foreground" /> : null}
              {needsAttention ? (
                <span title={attentionTitle} aria-label={attentionTitle}>
                  <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                </span>
              ) : null}
              {SHOW_AGENT_LOGOS
                ? agents.slice(0, 3).map((a) => {
                    const asset = agentAssets[a];
                    if (!asset) return null;
                    const isAdmin = adminAgent && a === adminAgent;
                    const label = agentMeta[a]?.label ?? asset.name;
                    const tooltip = isAdmin ? `${label} (admin)` : label;
                    return (
                      <span
                        key={`${ws.id}-agent-${a}`}
                        className={`inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-border/70 bg-muted/40 px-1.5 py-0 text-[11px] leading-none text-muted-foreground ${
                          isAdmin ? 'ring-1 ring-primary/60' : ''
                        }`}
                        title={tooltip}
                      >
                        <AgentLogo
                          logo={asset.logo}
                          alt={asset.alt}
                          isSvg={asset.isSvg}
                          invertInDark={asset.invertInDark}
                          className="h-3.5 w-3.5 shrink-0 rounded-sm"
                        />
                      </span>
                    );
                  })
                : null}
              {SHOW_AGENT_LOGOS && agents.length > 3 ? (
                <span className="inline-flex items-center rounded-md border border-border/70 bg-muted/40 px-1.5 py-0.5 text-[11px] text-muted-foreground">
                  +{agents.length - 3}
                </span>
              ) : null}
            </div>
          ) : busy || needsAttention ? (
            <div className="flex shrink-0 items-center gap-1">
              {busy ? <Spinner size="sm" className="shrink-0 text-muted-foreground" /> : null}
              {needsAttention ? (
                <span title={attentionTitle} aria-label={attentionTitle}>
                  <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                </span>
              ) : null}
              {asset && SHOW_AGENT_LOGOS ? (
                <AgentLogo
                  logo={asset.logo}
                  alt={asset.alt}
                  isSvg={asset.isSvg}
                  invertInDark={asset.invertInDark}
                  className="h-3.5 w-3.5 shrink-0 rounded-sm"
                />
              ) : null}
            </div>
          ) : null}
        </div>

        {SHOW_AGENT_LOGOS && adminAgent && agentAssets[adminAgent] ? (
          <div className="mt-2">
            <span className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-muted/40 px-1.5 py-0.5 text-[11px] text-muted-foreground">
              <span className="font-medium text-foreground/80">Admin:</span>
              <AgentLogo
                logo={agentAssets[adminAgent].logo}
                alt={agentAssets[adminAgent].alt}
                isSvg={agentAssets[adminAgent].isSvg}
                invertInDark={agentAssets[adminAgent].invertInDark}
                className="h-3.5 w-3.5 rounded-sm"
              />
            </span>
          </div>
        ) : null}
      </div>
    </AgentTooltip>
  );
};

export default KanbanCard;
