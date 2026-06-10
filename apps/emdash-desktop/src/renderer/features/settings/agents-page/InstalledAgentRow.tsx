import { AgentIcon } from '@renderer/lib/components/agent-icon';
import type { AgentPayload } from '@shared/core/agents/agent-payload';

export function InstalledAgentRow({ agent }: { agent: AgentPayload }) {
  return (
    <div className="group flex w-full items-center gap-3 rounded-lg p-3 hover:bg-background-1">
      <div className="flex size-9 items-center justify-center rounded-lg bg-background-1 p-1.5 group-hover:bg-background-2">
        <AgentIcon id={agent.id} size={20} />
      </div>
      <div className="flex flex-col gap-0.5 w-full">
        <div className="w-full flex items-center justify-between">
        <span className="text-sm text-foreground">{agent.name}</span>
        <span className="text-xs bg-background-success text-foreground-success rounded-md px-1.5 py-0.5">Installed</span>
        </div>
        <div className="w-full flex items-center justify-between">
        <span className="text-xs text-foreground-muted">Supports Hooks, Prompts, Sessions</span>
        <span className="text-tiny text-foreground-passive">v{agent.version}</span>
        </div>
      </div>
    </div>
  );
}
