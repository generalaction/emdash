import { iconRegistry } from '@emdash/cli-agent-plugins/icons';
import { cn } from '@renderer/utils/utils';
import { useTheme } from '../hooks/useTheme';

interface AgentIconProps {
  id: string;
  /** Icon size in pixels, passed directly to the PluginIcon component. Default: 16. */
  size?: number;
  /** Applied to the outer wrapper span — use for positioning, rounding, overflow, etc. */
  className?: string;
  grayscale?: boolean;
}

export function AgentIcon({ id, size = 16, className, grayscale }: AgentIconProps) {
  const { effectiveTheme } = useTheme();
  const mode = effectiveTheme === 'emdark' ? 'dark' : 'light';
  const Icon = iconRegistry.get(id);
  if (!Icon) return null;
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center',
        grayscale && 'grayscale',
        className
      )}
    >
      <Icon size={size} mode={mode} />
    </span>
  );
}
