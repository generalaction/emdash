import { Server } from 'lucide-react';
import React from 'react';
import { coerceRawSvgContent, prepareInlineSvgMarkup } from './mcp-icon-data';

const svgs = import.meta.glob('../../assets/images/mcp/*.svg', { query: '?raw', eager: true });

function keyFromPath(path: string): string {
  return path
    .split('/')
    .pop()!
    .replace(/\.\w+$/, '');
}

const svgByKey = new Map(
  Object.entries(svgs).map(([p, d]) => [keyFromPath(p), coerceRawSvgContent(d)])
);

function getIcon(key: string): { type: 'svg'; data: string } | undefined {
  const svg = svgByKey.get(key);
  if (typeof svg === 'string') return { type: 'svg', data: svg };
  return undefined;
}

export const McpServerIcon: React.FC<{ name: string; iconKey?: string }> = ({ name, iconKey }) => {
  const icon = iconKey ? getIcon(iconKey) : undefined;

  const renderIcon = () => {
    if (icon?.type === 'svg') {
      const processed = prepareInlineSvgMarkup(icon.data);
      return <div className="size-5" dangerouslySetInnerHTML={{ __html: processed }} />;
    }

    return <Server className="size-5 text-foreground-muted" />;
  };

  return (
    <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-background-2 transition-colors group-hover:bg-background-3">
      {renderIcon()}
    </div>
  );
};
