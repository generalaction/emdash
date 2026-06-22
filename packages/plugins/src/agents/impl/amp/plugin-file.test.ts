import { describe, expect, it } from 'vitest';
import { AMP_PLUGIN_CONTENT } from './plugin-file';

describe('AMP_PLUGIN_CONTENT', () => {
  it('emits session events with the Amp thread id', () => {
    expect(AMP_PLUGIN_CONTENT).toContain("amp.on('session.start'");
    expect(AMP_PLUGIN_CONTENT).toContain(
      "notifyEmdash('session', { session_id: event.thread.id })"
    );
  });

  it('includes the Amp thread id on start and stop events', () => {
    expect(AMP_PLUGIN_CONTENT).toContain("notifyEmdash('start', { session_id: event.thread.id })");
    expect(AMP_PLUGIN_CONTENT).toContain(
      "notifyEmdash('stop', { message: 'Task completed', session_id: event.thread.id })"
    );
  });
});
