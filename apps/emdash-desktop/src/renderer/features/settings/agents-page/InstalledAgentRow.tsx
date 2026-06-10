import AgentLogo from '@renderer/lib/components/agent-logo';
import { resolveAgentIcon } from '@renderer/lib/providers/meta';
import { AgentPayload } from '@shared/core/agents/agent-payload';

export function InstalledAgentRow({ agent }: { agent: AgentPayload }) {
  const logo = resolveAgentIcon(agent.iconName);
  const logoDark = resolveAgentIcon(agent.iconDarkName);

  return (
    <div className="group flex w-full items-center gap-3 rounded-lg p-3 hover:bg-background-1">
      <div className="flex size-9 items-center justify-center rounded-lg bg-background-1 p-1.5 group-hover:bg-background-2">
        {logo && <AgentLogo logo={logo} logoDark={logoDark} alt={agent.name} className="size-5" />}
      </div>
      <div className="flex flex-col gap-1 w-full">
        <div className="w-full flex items-center justify-between">
        <span className="text-sm text-foreground">{agent.name}</span>
        <span className="text-xs bg-background-success text-foreground-success rounded-md px-2 py-0.5">Installed</span>
        </div>
        <div className="w-full flex items-center justify-between">
        <span className="text-xs text-foreground-muted">Supports Hooks, Prompts, Sessions</span>
        <span className="text-xs text-foreground-passive">v{agent.version}</span>

        </div>
      </div>
    </div>
  );
}
