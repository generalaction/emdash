import { pickIconVariant } from '@emdash/shared/agents/plugins';
import { cn } from '@renderer/utils/utils';
import { useTheme } from '../hooks/useTheme';
import { useAgentIcon } from '../stores/use-agents';

interface AgentIconProps {
  id: string;
  /** Icon size in pixels. Default: 16. */
  size?: number;
  /** Applied to the outer wrapper span — use for positioning, rounding, overflow, etc. */
  className?: string;
  grayscale?: boolean;
}

export function AgentIcon({ id, size = 16, className, grayscale }: AgentIconProps) {
  const { effectiveTheme } = useTheme();
  const mode = effectiveTheme === 'emdark' ? 'dark' : 'light';
  const icon = useAgentIcon(id);

  if (!icon) return null;

  const variant = pickIconVariant(icon.variants, size);
  if (!variant) return null;

  const shouldInvert = mode === 'dark' && icon.invertInDark;
  const content = mode === 'dark' && variant.dark ? variant.dark : variant.light;

  const wrapperClass = cn(
    'inline-flex shrink-0 items-center justify-center',
    grayscale && 'grayscale',
    shouldInvert && 'invert',
    className
  );

  if (icon.kind === 'image') {
    return (
      <span className={wrapperClass} style={{ width: size, height: size }}>
        <img src={content} alt={icon.alt ?? id} width={size} height={size} />
      </span>
    );
  }

  return (
    <span
      className={wrapperClass}
      style={{ width: size, height: size }}
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: content }}
    />
  );
}
