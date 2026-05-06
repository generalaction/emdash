import { describe, expect, it } from 'vitest';
import { getAgentInstallActionState, getAgentInstallErrorMessage } from './agent-install';
import {
  buildAgentGroups,
  canInstallAgentOption,
  getAssumedInstalledAgents,
  getInstallButtonState,
  isComboboxOptionDisabled,
} from './agent-selector-options';

describe('buildAgentGroups', () => {
  it('marks installed agents selectable and uninstalled agents disabled', () => {
    const groups = buildAgentGroups(['codex']);

    expect(groups.find((group) => group.value === 'installed')?.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ agentId: 'codex', disabled: false })])
    );
    expect(groups.find((group) => group.value === 'not-installed')?.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ agentId: 'claude', disabled: true })])
    );
  });

  it('keeps the selected agent installed while availability is still unknown', () => {
    const groups = buildAgentGroups([], ['codex']);

    expect(groups.find((group) => group.value === 'installed')?.items).toEqual([
      expect.objectContaining({ agentId: 'codex', disabled: false }),
    ]);
    expect(groups.find((group) => group.value === 'not-installed')?.items).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ agentId: 'codex' })])
    );
  });

  it('keeps the selected agent installed when dependency data is partial', () => {
    const assumedInstalledAgents = getAssumedInstalledAgents('codex', {
      claude: {
        id: 'claude',
        category: 'agent',
        status: 'available',
        version: '1.0.0',
        path: '/bin/claude',
        checkedAt: 1,
      },
    });
    const groups = buildAgentGroups(['claude'], assumedInstalledAgents);

    expect(groups.find((group) => group.value === 'installed')?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ agentId: 'claude', disabled: false }),
        expect.objectContaining({ agentId: 'codex', disabled: false }),
      ])
    );
    expect(groups.find((group) => group.value === 'not-installed')?.items).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ agentId: 'codex' })])
    );
  });

  it('keeps inline-install rows disabled while allowing install actions', () => {
    const item = buildAgentGroups(['codex'])
      .find((group) => group.value === 'not-installed')
      ?.items.find((option) => option.agentId === 'claude');

    expect(item).toBeDefined();
    expect(canInstallAgentOption(item!, true)).toBe(true);
    expect(isComboboxOptionDisabled(item!)).toBe(true);
    expect(getInstallButtonState(item!, true, new Set())).toEqual({
      render: true,
      disabled: false,
      installing: false,
      label: 'Install Claude Code',
    });
  });

  it('maps permission install errors to friendly copy', () => {
    expect(
      getAgentInstallErrorMessage({
        type: 'permission-denied',
        message: 'User does not have sufficient permissions.',
        output: 'permission denied',
        exitCode: 243,
      })
    ).toBe('User does not have sufficient permissions.');
  });

  it('supports non-combobox install actions', () => {
    expect(
      getAgentInstallActionState({
        agentId: 'cursor',
        canInstall: true,
        isInstalled: false,
        isInstalling: true,
      })
    ).toEqual({
      render: true,
      disabled: true,
      installing: true,
      label: 'Install Cursor',
    });

    expect(
      getAgentInstallActionState({
        agentId: 'cursor',
        canInstall: true,
        isInstalled: true,
        isInstalling: false,
      }).render
    ).toBe(false);
  });

  it('only disables the actively installing agent button', () => {
    const notInstalledItems =
      buildAgentGroups(['codex']).find((group) => group.value === 'not-installed')?.items ?? [];
    const claude = notInstalledItems.find((option) => option.agentId === 'claude')!;
    const qwen = notInstalledItems.find((option) => option.agentId === 'qwen')!;

    expect(getInstallButtonState(claude, true, new Set(['claude']))).toEqual({
      render: true,
      disabled: true,
      installing: true,
      label: 'Install Claude Code',
    });
    expect(getInstallButtonState(qwen, true, new Set(['claude']))).toEqual({
      render: true,
      disabled: false,
      installing: false,
      label: 'Install Qwen Code',
    });
  });

  it('supports multiple active installs at the same time', () => {
    const notInstalledItems =
      buildAgentGroups(['codex']).find((group) => group.value === 'not-installed')?.items ?? [];
    const claude = notInstalledItems.find((option) => option.agentId === 'claude')!;
    const qwen = notInstalledItems.find((option) => option.agentId === 'qwen')!;

    expect(getInstallButtonState(claude, true, new Set(['claude', 'qwen']))).toEqual({
      render: true,
      disabled: true,
      installing: true,
      label: 'Install Claude Code',
    });
    expect(getInstallButtonState(qwen, true, new Set(['claude', 'qwen']))).toEqual({
      render: true,
      disabled: true,
      installing: true,
      label: 'Install Qwen Code',
    });
  });
});
