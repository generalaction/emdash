import { cn } from '@renderer/utils/utils';
import type { AgentIconAsset } from '@shared/core/agents/agent-payload';
import { useTheme } from '../hooks/useTheme';
import { pickIconVariant } from './agent-icon-variant';

type PluginIconProps = {
  id: string;
  icon: AgentIconAsset;
  size?: number;
  className?: string;
  grayscale?: boolean;
};

export function PluginIcon({ id, icon, size = 16, className, grayscale }: PluginIconProps) {
  const { effectiveTheme } = useTheme();
  const mode = effectiveTheme === 'emdark' ? 'dark' : 'light';
  const variant = pickIconVariant(icon.variants, size);
  if (!variant) return null;

  const shouldInvert = mode === 'dark' && icon.invertInDark;
  const content = mode === 'dark' && variant.dark ? variant.dark : variant.light;

  const wrapperClass = cn(
    'inline-flex shrink-0 items-center justify-center [&>svg]:h-full [&>svg]:w-full',
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
