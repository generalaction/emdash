import { AgentIcon } from '@renderer/lib/components/agent-icon';
import { useAgents } from '@renderer/lib/stores/use-agents';

interface StackedAgentLogosProps {
  /** Map of providerId to conversation count, same shape as task.conversationStats */
  stats: Record<string, number>;
}

export function StackedAgentLogos({ stats }: StackedAgentLogosProps) {
  const entries = Object.entries(stats);
  const { data: agents } = useAgents();
  if (entries.length === 0) return null;

  const nameMap = new Map((agents ?? []).map((a) => [a.id, a.name]));

  return (
    <div className="flex shrink-0 items-center [&>span]:ring-2 [&>span]:ring-background [&>span:not(:first-child)]:-ml-1.5">
      {entries.map(([providerId, count]) => {
        const name = nameMap.get(providerId) ?? providerId;
        return (
          <span
            key={providerId}
            className="relative flex h-5 w-5 items-center justify-center overflow-hidden rounded-sm bg-background-2"
            title={count > 1 ? `${name}: ${String(count)}` : name}
          >
            <AgentIcon id={providerId} size={14} />
            {count > 1 && (
              <span className="absolute -right-px -bottom-px rounded-tl bg-background px-px text-[8px] leading-none font-semibold text-foreground-passive">
                {count}
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}
