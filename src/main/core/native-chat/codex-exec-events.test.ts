import { describe, expect, it } from 'vitest';
import { isIgnorableCodexNotice, parseCodexExecLine } from './codex-exec-events';

describe('parseCodexExecLine', () => {
  it('parses thread.started', () => {
    expect(
      parseCodexExecLine(
        '{"type":"thread.started","thread_id":"019e966e-a5fc-7600-a34d-624266ca1dca"}',
        't1'
      )
    ).toEqual({ type: 'thread-started', threadId: '019e966e-a5fc-7600-a34d-624266ca1dca' });
  });

  it('parses turn lifecycle events', () => {
    expect(parseCodexExecLine('{"type":"turn.started"}', 't1')).toEqual({ type: 'turn-started' });
    expect(
      parseCodexExecLine('{"type":"turn.completed","usage":{"input_tokens":1}}', 't1')
    ).toEqual({ type: 'turn-completed' });
    expect(parseCodexExecLine('{"type":"turn.failed","error":{"message":"boom"}}', 't1')).toEqual({
      type: 'turn-failed',
      message: 'boom',
    });
  });

  it('parses agent messages with turn-scoped keys', () => {
    expect(
      parseCodexExecLine(
        '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"pong"}}',
        't2'
      )
    ).toEqual({ type: 'item', item: { kind: 'agent_message', key: 't2:item_0', text: 'pong' } });
  });

  it('parses command executions across started and completed', () => {
    const started = parseCodexExecLine(
      '{"type":"item.started","item":{"id":"item_0","type":"command_execution","command":"ls -la","aggregated_output":"","exit_code":null,"status":"in_progress"}}',
      't1'
    );
    expect(started).toEqual({
      type: 'item',
      item: {
        kind: 'command_execution',
        key: 't1:item_0',
        command: 'ls -la',
        aggregatedOutput: '',
        exitCode: null,
        status: 'in_progress',
      },
    });

    const completed = parseCodexExecLine(
      '{"type":"item.completed","item":{"id":"item_0","type":"command_execution","command":"ls -la","aggregated_output":"total 8\\n","exit_code":0,"status":"completed"}}',
      't1'
    );
    expect(completed).toEqual({
      type: 'item',
      item: {
        kind: 'command_execution',
        key: 't1:item_0',
        command: 'ls -la',
        aggregatedOutput: 'total 8\n',
        exitCode: 0,
        status: 'completed',
      },
    });
  });

  it('parses file changes and todo lists tolerantly', () => {
    expect(
      parseCodexExecLine(
        '{"type":"item.completed","item":{"id":"item_3","type":"file_change","changes":[{"path":"src/a.ts","kind":"update"},{"bogus":true}],"status":"completed"}}',
        't1'
      )
    ).toEqual({
      type: 'item',
      item: {
        kind: 'file_change',
        key: 't1:item_3',
        changes: [{ path: 'src/a.ts', kind: 'update' }],
        status: 'completed',
      },
    });

    expect(
      parseCodexExecLine(
        '{"type":"item.completed","item":{"id":"item_4","type":"todo_list","items":[{"text":"a","completed":true},{"text":"b"}]}}',
        't1'
      )
    ).toEqual({
      type: 'item',
      item: {
        kind: 'todo_list',
        key: 't1:item_4',
        items: [
          { text: 'a', completed: true },
          { text: 'b', completed: false },
        ],
      },
    });
  });

  it('classifies bypass-flag warnings as ignorable notices', () => {
    expect(
      isIgnorableCodexNotice(
        '`--dangerously-bypass-hook-trust` is enabled. Enabled hooks may run without review for this invocation.'
      )
    ).toBe(true);
    expect(isIgnorableCodexNotice('`--dangerously-bypass-approvals-and-sandbox` is enabled.')).toBe(
      true
    );
    expect(isIgnorableCodexNotice('command failed: permission denied')).toBe(false);
  });

  it('ignores unknown events, unknown item types, blanks, and malformed JSON', () => {
    expect(parseCodexExecLine('{"type":"some.future.event"}', 't1')).toEqual({ type: 'ignored' });
    expect(
      parseCodexExecLine('{"type":"item.completed","item":{"id":"x","type":"hologram"}}', 't1')
    ).toEqual({ type: 'ignored' });
    expect(parseCodexExecLine('', 't1')).toEqual({ type: 'ignored' });
    expect(parseCodexExecLine('not json', 't1')).toEqual({ type: 'ignored' });
    expect(parseCodexExecLine('[1,2,3]', 't1')).toEqual({ type: 'ignored' });
  });
});
