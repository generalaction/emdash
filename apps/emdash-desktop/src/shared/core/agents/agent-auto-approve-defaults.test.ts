import { describe, expect, it } from 'vitest';
import {
  buildGlobalAutoApproveDefaults,
  getAgentAutoApproveDefault,
  isGlobalAutoApproveEnabled,
  providerSupportsAutoApprove,
  resolveAgentAutoApprove,
} from './agent-auto-approve-defaults';

describe('agent-auto-approve-defaults', () => {
  it('detects providers that support auto-approve', () => {
    expect(providerSupportsAutoApprove('claude')).toBe(true);
    expect(providerSupportsAutoApprove('jules')).toBe(false);
  });

  it('builds global defaults for all capable providers', () => {
    const enabled = buildGlobalAutoApproveDefaults(true);
    expect(getAgentAutoApproveDefault(enabled, 'claude')).toBe(true);
    expect(getAgentAutoApproveDefault(enabled, 'jules')).toBe(false);
    expect(isGlobalAutoApproveEnabled(enabled)).toBe(true);
  });

  it('uses the empty canonical default when global auto-approve is disabled', () => {
    expect(buildGlobalAutoApproveDefaults(false)).toEqual({});
    expect(isGlobalAutoApproveEnabled(undefined)).toBe(false);
    expect(isGlobalAutoApproveEnabled({})).toBe(false);
  });

  it('does not treat per-agent defaults as globally enabled', () => {
    expect(isGlobalAutoApproveEnabled({ claude: true })).toBe(false);
  });

  it('resolves explicit auto-approve over stored defaults', () => {
    expect(resolveAgentAutoApprove(true, {}, 'claude')).toBe(true);
    expect(resolveAgentAutoApprove(undefined, { claude: true }, 'claude')).toBe(true);
    expect(resolveAgentAutoApprove(undefined, {}, 'claude')).toBe(false);
  });
});
