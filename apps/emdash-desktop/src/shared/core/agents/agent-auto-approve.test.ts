import { describe, expect, it } from 'vitest';
import {
  providerSupportsAutoApprove,
  resolveAutomationAgentAutoApprove,
} from './agent-auto-approve';

describe('agent-auto-approve', () => {
  it('detects providers that support auto-approve', () => {
    expect(providerSupportsAutoApprove('claude')).toBe(true);
    expect(providerSupportsAutoApprove('jules')).toBe(false);
  });

  it('forces automations to auto-approve for supported providers', () => {
    expect(resolveAutomationAgentAutoApprove('claude', false)).toBe(true);
    expect(resolveAutomationAgentAutoApprove('jules', false)).toBe(false);
    expect(resolveAutomationAgentAutoApprove('unknown', false)).toBe(false);
  });
});
