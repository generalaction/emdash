import { describe, expect, it } from 'vitest';
import {
  getAgentTabSelectionIndex,
  getTaskSelectionIndex,
} from '../../renderer/hooks/useKeyboardShortcuts';

describe('getAgentTabSelectionIndex', () => {
  it('maps Cmd/Ctrl+1 through Cmd/Ctrl+9 to zero-based tab indexes (default: agents use Cmd)', () => {
    expect(
      getAgentTabSelectionIndex(
        {
          key: '1',
          metaKey: true,
          ctrlKey: false,
          altKey: false,
          shiftKey: false,
        } as KeyboardEvent,
        false // useCtrlForAgents = false (default: Cmd for agents)
      )
    ).toBe(0);

    expect(
      getAgentTabSelectionIndex(
        {
          key: '9',
          metaKey: true,
          ctrlKey: false,
          altKey: false,
          shiftKey: false,
        } as KeyboardEvent,
        false
      )
    ).toBe(8);
  });

  it('accepts Ctrl+number as the Command equivalent on non-mac platforms', () => {
    expect(
      getAgentTabSelectionIndex(
        {
          key: '4',
          metaKey: false,
          ctrlKey: true,
          altKey: false,
          shiftKey: false,
        } as KeyboardEvent,
        false, // useCtrlForAgents
        false // isMac
      )
    ).toBe(3);
  });

  it('ignores keys outside 1-9 and modified variants', () => {
    expect(
      getAgentTabSelectionIndex(
        {
          key: '0',
          metaKey: true,
          ctrlKey: false,
          altKey: false,
          shiftKey: false,
        } as KeyboardEvent,
        false
      )
    ).toBeNull();

    expect(
      getAgentTabSelectionIndex(
        {
          key: '1',
          metaKey: true,
          ctrlKey: false,
          altKey: false,
          shiftKey: true,
        } as KeyboardEvent,
        false
      )
    ).toBeNull();

    expect(
      getAgentTabSelectionIndex(
        {
          key: '1',
          metaKey: true,
          ctrlKey: false,
          altKey: true,
          shiftKey: false,
        } as KeyboardEvent,
        false
      )
    ).toBeNull();

    expect(
      getAgentTabSelectionIndex(
        {
          key: '1',
          metaKey: false,
          ctrlKey: false,
          altKey: false,
          shiftKey: false,
        } as KeyboardEvent,
        false
      )
    ).toBeNull();
  });

  it('uses Ctrl for agents when useCtrlForAgents is true', () => {
    // When tasks use Cmd, agents use Ctrl
    expect(
      getAgentTabSelectionIndex(
        {
          key: '1',
          metaKey: false,
          ctrlKey: true,
          altKey: false,
          shiftKey: false,
        } as KeyboardEvent,
        true // useCtrlForAgents = true
      )
    ).toBe(0);

    // Cmd should NOT work when agents are set to use Ctrl
    expect(
      getAgentTabSelectionIndex(
        {
          key: '1',
          metaKey: true,
          ctrlKey: false,
          altKey: false,
          shiftKey: false,
        } as KeyboardEvent,
        true // useCtrlForAgents = true
      )
    ).toBeNull();
  });
});

describe('getTaskSelectionIndex', () => {
  it('maps Ctrl+1 through Ctrl+9 to zero-based task indexes (default: tasks use Ctrl)', () => {
    expect(
      getTaskSelectionIndex(
        {
          key: '1',
          metaKey: false,
          ctrlKey: true,
          altKey: false,
          shiftKey: false,
        } as KeyboardEvent,
        false // useCmdForTasks = false (default: Ctrl for tasks)
      )
    ).toBe(0);

    expect(
      getTaskSelectionIndex(
        {
          key: '9',
          metaKey: false,
          ctrlKey: true,
          altKey: false,
          shiftKey: false,
        } as KeyboardEvent,
        false
      )
    ).toBe(8);
  });

  it('uses Cmd for tasks when useCmdForTasks is true', () => {
    // When tasks use Cmd
    expect(
      getTaskSelectionIndex(
        {
          key: '1',
          metaKey: true,
          ctrlKey: false,
          altKey: false,
          shiftKey: false,
        } as KeyboardEvent,
        true, // useCmdForTasks = true
        true // isMac
      )
    ).toBe(0);

    // Ctrl should NOT work when tasks are set to use Cmd
    expect(
      getTaskSelectionIndex(
        {
          key: '1',
          metaKey: false,
          ctrlKey: true,
          altKey: false,
          shiftKey: false,
        } as KeyboardEvent,
        true // useCmdForTasks = true
      )
    ).toBeNull();
  });

  it('ignores keys outside 1-9 and modified variants', () => {
    expect(
      getTaskSelectionIndex(
        {
          key: '0',
          metaKey: false,
          ctrlKey: true,
          altKey: false,
          shiftKey: false,
        } as KeyboardEvent,
        false
      )
    ).toBeNull();

    expect(
      getTaskSelectionIndex(
        {
          key: '1',
          metaKey: false,
          ctrlKey: true,
          altKey: false,
          shiftKey: true,
        } as KeyboardEvent,
        false
      )
    ).toBeNull();

    expect(
      getTaskSelectionIndex(
        {
          key: '1',
          metaKey: false,
          ctrlKey: true,
          altKey: true,
          shiftKey: false,
        } as KeyboardEvent,
        false
      )
    ).toBeNull();

    expect(
      getTaskSelectionIndex(
        {
          key: '1',
          metaKey: false,
          ctrlKey: false,
          altKey: false,
          shiftKey: false,
        } as KeyboardEvent,
        false
      )
    ).toBeNull();
  });
});
