import { describe, expect, it } from 'vitest';
import { detectPlanModeSignal } from '../../renderer/lib/planModeDetector';

describe('detectPlanModeSignal', () => {
  it('detects real Claude Code plan presentation output', () => {
    expect(detectPlanModeSignal("Here is Claude's plan:")).toBe('plan_ready');
    expect(detectPlanModeSignal('Here is Claude plan:')).toBe('plan_ready');
    expect(detectPlanModeSignal('Ready to code?')).toBe('plan_ready');
    expect(detectPlanModeSignal('Ready to code?\n')).toBe('plan_ready');
  });

  it('detects plan file path reference', () => {
    expect(detectPlanModeSignal('Plan saved to .claude/plans/my-plan.md')).toBe('plan_ready');
    expect(detectPlanModeSignal('Writing plan to .claude/plans/compressed-frolicking-owl.md')).toBe(
      'plan_ready'
    );
  });

  it('detects approval prompts', () => {
    expect(detectPlanModeSignal('Do you want to proceed with this plan?')).toBe('plan_ready');
    expect(detectPlanModeSignal('Do you want to execute the implementation?')).toBe('plan_ready');
    expect(detectPlanModeSignal('Do you want to approve this plan?')).toBe('plan_ready');
    expect(detectPlanModeSignal('Do you want to implement this?')).toBe('plan_ready');
  });

  it('detects ExitPlanMode reference', () => {
    expect(detectPlanModeSignal('Calling ExitPlanMode to present the plan')).toBe('plan_ready');
  });

  it('handles ANSI escape codes', () => {
    const ansi = '\x1b[1m.claude/plans/test.md\x1b[0m';
    expect(detectPlanModeSignal(ansi)).toBe('plan_ready');
    expect(detectPlanModeSignal("\x1b[1mHere is Claude's plan:\x1b[0m")).toBe('plan_ready');
  });

  it('detects plan approved', () => {
    expect(detectPlanModeSignal('Plan approved. Starting implementation.')).toBe('plan_approved');
    expect(detectPlanModeSignal('Plan accepted by user')).toBe('plan_approved');
    expect(detectPlanModeSignal('Proceeding with the implementation')).toBe('plan_approved');
    expect(detectPlanModeSignal('Proceeding with implementation')).toBe('plan_approved');
  });

  it('detects exiting/exited plan mode', () => {
    expect(detectPlanModeSignal('Exiting plan mode')).toBe('plan_approved');
    expect(detectPlanModeSignal('Exited plan mode')).toBe('plan_approved');
  });

  it('detects plan rejected', () => {
    expect(detectPlanModeSignal('Plan rejected')).toBe('plan_rejected');
    expect(detectPlanModeSignal('Plan declined by user')).toBe('plan_rejected');
  });

  it('returns none for unrelated input', () => {
    expect(detectPlanModeSignal('')).toBe('none');
    expect(detectPlanModeSignal('Hello world')).toBe('none');
    expect(detectPlanModeSignal('Thinking...')).toBe('none');
    expect(detectPlanModeSignal('Reading file src/main.ts')).toBe('none');
  });

  it('returns none for null-ish input', () => {
    expect(detectPlanModeSignal(null as any)).toBe('none');
    expect(detectPlanModeSignal(undefined as any)).toBe('none');
  });

  it('strips carriage returns before matching', () => {
    expect(detectPlanModeSignal('Plan approved\r\n')).toBe('plan_approved');
  });

  it('strips OSC escape sequences', () => {
    const osc = '\x1b]0;Claude Code\x07Plan rejected';
    expect(detectPlanModeSignal(osc)).toBe('plan_rejected');
  });
});
