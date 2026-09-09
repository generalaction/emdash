/**
 * @vitest-environment jsdom
 */
import { render } from '@testing-library/react';
import { CircleIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { Icon } from '../../primitives/icon';
import { AgentStatus } from '../agent-status/agent-status';
import { MachineStatus } from '../machine-status/machine-status';
import { ScriptStatus } from '../script-status/script-status';
import { WorkspaceIcon } from '../workspace-icon/workspace-icon';

describe('status Icon composition', () => {
  it.each([
    ['workspace', <WorkspaceIcon key="workspace" type="repository" status="active" />],
    ['agent', <AgentStatus key="agent" status="working" />],
    ['machine', <MachineStatus key="machine" status="successful" />],
    ['script', <ScriptStatus key="script" status="success" />],
  ] as const)('%s status applies the owned Icon contract to its SVG root', (_name, element) => {
    expectOwnedIcon(element);
  });
});

function expectOwnedIcon(element: ReactElement): void {
  const owned = render(<Icon source={CircleIcon} />).container.querySelector('svg');
  const rendered = render(element).container.querySelector('svg');
  const ownedClasses = new Set(owned?.classList ?? []);

  expect(rendered).not.toBeNull();
  expect([...rendered!.classList].some((className) => ownedClasses.has(className))).toBe(true);
  expect(rendered?.getAttribute('aria-hidden')).toBe('true');
}
