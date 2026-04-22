import { Server } from 'lucide-react';
import React from 'react';
import { coerceRawSvgContent, prepareInlineSvgMarkup } from './mcp-icon-data';

const svgs = import.meta.glob('../../assets/images/mcp/*.svg', { as: 'raw', eager: true });
const pngs = import.meta.glob('../../assets/images/mcp/*.png', { eager: true, import: 'default' });

function keyFromPath(path: string): string {
  return path
    .split('/')
    .pop()!
    .replace(/\.\w+$/, '');
}

const svgByKey = new Map(
  Object.entries(svgs).map(([p, d]) => [keyFromPath(p), coerceRawSvgContent(d)])
);
const pngByKey = new Map(Object.entries(pngs).map(([p, d]) => [keyFromPath(p), d as string]));

function getIcon(
  key: string
): { type: 'svg'; data: string } | { type: 'png'; url: string } | undefined {
  const svg = svgByKey.get(key);
  if (typeof svg === 'string') return { type: 'svg', data: svg };
  const png = pngByKey.get(key);
  if (png) return { type: 'png', url: png };
  return undefined;
}

const ICON_CONTAINER = 'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted/40';

export const McpServerIcon: React.FC<{ name: string; iconKey?: string }> = ({ name, iconKey }) => {
  const icon = iconKey ? getIcon(iconKey) : undefined;

  if (icon?.type === 'svg') {
    const processed = prepareInlineSvgMarkup(icon.data);
    return (
      <div className={`${ICON_CONTAINER} p-2`} dangerouslySetInnerHTML={{ __html: processed }} />
    );
  }

  if (icon?.type === 'png') {
    return (
      <div className={`${ICON_CONTAINER} p-2`}>
        <img
          src={icon.url}
          alt={name}
          className="h-full w-full object-contain brightness-0 dark:invert"
        />
      </div>
    );
  }

  return (
    <div className={ICON_CONTAINER}>
      <Server className="h-5 w-5 text-muted-foreground" />
    </div>
  );
};
