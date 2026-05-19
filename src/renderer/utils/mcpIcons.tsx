import { Server } from 'lucide-react';
import React from 'react';
import { coerceRawSvgContent, prepareInlineSvgMarkup } from './mcp-icon-data';

const svgs = import.meta.glob('../../assets/images/mcp/*.svg', { query: '?raw', eager: true });
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

export const McpServerIcon: React.FC<{ name: string; iconKey?: string }> = ({ name, iconKey }) => {
  const icon = iconKey ? getIcon(iconKey) : undefined;

  const renderIcon = () => {
    if (icon?.type === 'svg') {
      const processed = prepareInlineSvgMarkup(icon.data);
      return <div dangerouslySetInnerHTML={{ __html: processed }} />;
    }

    if (icon?.type === 'png') {
      return (
        <img
          src={icon.url}
          alt={name}
          className="h-full w-full object-contain brightness-0 dark:invert"
        />
      );
    }

    return <Server className="h-5 w-5 text-muted-foreground" />;
  };

  return (
    <div className="size-10 p-3 bg-background-2 rounded-lg group-hover:bg-background-3 transition-colors">
      {renderIcon()}
    </div>
  );
};
