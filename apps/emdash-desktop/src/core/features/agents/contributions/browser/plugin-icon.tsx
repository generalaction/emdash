import type { PluginIconAsset } from '@emdash/shared/plugins';
import type { CSSProperties } from 'react';
import { pickIconVariant } from '@core/primitives/agents/browser/agent-icon-variant';
import { cn } from '@core/primitives/styling/browser/cn';
import { useTheme } from '@core/primitives/theme/browser';
import { pluginAssetAdapter } from './plugin-icon.adapter.css';

type PluginIconProps = {
  id: string;
  icon: PluginIconAsset;
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
    pluginAssetAdapter,
    grayscale && 'grayscale',
    shouldInvert && 'invert',
    className
  );
  const wrapperStyle = {
    '--_plugin-icon-size': `${size}px`,
  } as CSSProperties;

  if (icon.kind === 'image') {
    return (
      <span className={wrapperClass} style={wrapperStyle} data-foreign-adapter="plugin-asset">
        <img src={content} alt={icon.alt ?? id} width={size} height={size} />
      </span>
    );
  }

  return (
    <span
      className={wrapperClass}
      style={wrapperStyle}
      data-foreign-adapter="plugin-asset"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: content }}
    />
  );
}
