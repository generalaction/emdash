import { CircleFadingArrowUp, CirclePlayIcon } from 'lucide-react';
import React from 'react';
import { type ScriptType } from '@renderer/features/tasks/stores/lifecycle-scripts';
import { getPaneContainer } from '@renderer/lib/pty/pane-sizing-context';
import { measureDimensions } from '@renderer/lib/pty/pty-dimensions';

export function getTerminalsPaneSize() {
  const container = getPaneContainer('terminal-drawer');
  return container ? (measureDimensions(container, 8, 16) ?? undefined) : undefined;
}

export function nextTerminalName(names: string[]): string {
  const taken = new Set(
    names
      .map((n) => /^Terminal (\d+)$/.exec(n)?.[1])
      .filter(Boolean)
      .map(Number)
  );
  let n = 1;
  while (taken.has(n)) n++;
  return `Terminal ${n}`;
}

export function scriptIcon(type: ScriptType): React.ReactNode {
  if (type === 'setup') return <CircleFadingArrowUp className="size-3.5" />;
  if (type === 'run') return <CirclePlayIcon className="size-3.5" />;
  return <CircleFadingArrowUp className="size-3.5 rotate-180" />;
}
