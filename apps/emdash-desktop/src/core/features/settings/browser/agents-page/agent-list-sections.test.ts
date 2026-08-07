import { describe, expect, it } from 'vitest';
import {
  buildAgentSections,
  type AgentListItem,
} from '@core/features/settings/browser/agents-page/agent-list-sections';

const agents = [
  { id: 'opencode', name: 'OpenCode', status: 'available' },
  { id: 'codex', name: 'Codex', status: 'missing' },
  { id: 'claude', name: 'Claude', status: 'available' },
  { id: 'qwen', name: 'Qwen', status: 'missing' },
  { id: 'pi', name: 'Pi', status: 'missing' },
  { id: 'auggie', name: 'Auggie', status: 'missing' },
] satisfies AgentListItem[];

describe('buildAgentSections', () => {
  it('groups installed agents first, then uninstalled recommendations, then other agents', () => {
    const sections = buildAgentSections(agents);

    expect(sections.map((section) => section.label)).toEqual([
      'Installed',
      'Recommended',
      'Not installed',
    ]);
    expect(sections.map((section) => section.agents.map((agent) => agent.name))).toEqual([
      ['Claude', 'OpenCode'],
      ['Codex', 'Pi'],
      ['Auggie', 'Qwen'],
    ]);
  });

  it('filters across every section while preserving section order', () => {
    const sections = buildAgentSections(agents, 'o');

    expect(sections.map((section) => section.agents.map((agent) => agent.name))).toEqual([
      ['OpenCode'],
      ['Codex'],
      [],
    ]);
  });
});
