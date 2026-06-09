import AgentLogo from '@renderer/lib/components/agent-logo';
import { agentConfig } from '@renderer/utils/agentConfig';

interface StackedAgentLogosProps {
  /** Map of providerId to conversation count, same shape as task.conversationStats */
  stats: Record<string, number>;
}

export function StackedAgentLogos({ stats }: StackedAgentLogosProps) {
  const entries = Object.entries(stats);
  if (entries.length === 0) return null;

  return (
    <div className="flex shrink-0 items-center [&>span]:ring-2 [&>span]:ring-background [&>span:not(:first-child)]:-ml-1.5">
      {entries.map(([providerId, count]) => {
        const config = agentConfig[providerId as keyof typeof agentConfig];
        if (!config) return null;
        return (
          <span
            key={providerId}
            className="relative flex h-5 w-5 items-center justify-center overflow-hidden rounded-sm bg-background-2"
            title={count > 1 ? `${config.name}: ${String(count)}` : config.name}
          >
            <AgentLogo
              logo={config.logo}
              logoDark={config.logoDark}
              alt={config.alt}
              isSvg={config.isSvg}
              invertInDark={config.invertInDark}
              className="h-3.5 w-3.5"
            />
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
