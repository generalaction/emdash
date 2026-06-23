import { describe, expect, it } from 'vitest';
import {
  createClaudeStreamParser,
  createPiStreamParser,
  isIgnorableCodexNotice,
  parseCodexExecLine,
} from './native-exec-events';

// Shapes sampled from a real `claude -p --output-format stream-json --verbose` run.
const CLAUDE_INIT_LINE =
  '{"type":"system","subtype":"init","cwd":"/tmp/x","session_id":"49df8b52-4204-4043-93c8-3eaca858922a","tools":["Bash"],"model":"claude-opus-4-8","permissionMode":"default"}';

const CLAUDE_TOOL_USE_LINE =
  '{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_01N","name":"Bash","input":{"command":"ls -la","description":"List files"}}]},"session_id":"49df8b52"}';

const CLAUDE_TOOL_RESULT_LINE =
  '{"type":"user","message":{"role":"user","content":[{"tool_use_id":"toolu_01N","type":"tool_result","content":"total 0\\nfile.txt","is_error":false}]},"session_id":"49df8b52"}';

const CLAUDE_TEXT_LINE =
  '{"type":"assistant","message":{"role":"assistant","content":[{"type":"thinking","thinking":"Let me check.","signature":"x"},{"type":"text","text":"There are 2 entries."}]},"session_id":"49df8b52"}';

const CLAUDE_RESULT_LINE =
  '{"type":"result","subtype":"success","is_error":false,"duration_ms":6296,"num_turns":2,"result":"There are 2 entries.","session_id":"49df8b52-4204-4043-93c8-3eaca858922a"}';

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

describe('createClaudeStreamParser', () => {
  it('extracts the session id from init', () => {
    const parser = createClaudeStreamParser('t1');
    expect(parser.parseLine(CLAUDE_INIT_LINE)).toEqual([
      { type: 'thread-started', threadId: '49df8b52-4204-4043-93c8-3eaca858922a' },
    ]);
  });

  it('maps Bash tool_use and completes it from the matching tool_result', () => {
    const parser = createClaudeStreamParser('t1');
    const started = parser.parseLine(CLAUDE_TOOL_USE_LINE);
    expect(started).toEqual([
      {
        type: 'item',
        item: {
          kind: 'command_execution',
          key: 't1:b0',
          command: 'ls -la',
          aggregatedOutput: '',
          exitCode: null,
          status: 'in_progress',
        },
      },
    ]);

    const completed = parser.parseLine(CLAUDE_TOOL_RESULT_LINE);
    expect(completed).toEqual([
      {
        type: 'item',
        item: {
          kind: 'command_execution',
          key: 't1:b0',
          command: 'ls -la',
          aggregatedOutput: 'total 0\nfile.txt',
          exitCode: 0,
          status: 'completed',
        },
      },
    ]);
  });

  it('maps thinking and text blocks in one assistant message', () => {
    const parser = createClaudeStreamParser('t2');
    expect(parser.parseLine(CLAUDE_TEXT_LINE)).toEqual([
      { type: 'item', item: { kind: 'reasoning', key: 't2:b0', text: 'Let me check.' } },
      { type: 'item', item: { kind: 'agent_message', key: 't2:b1', text: 'There are 2 entries.' } },
    ]);
  });

  it('maps file edits, web searches, todos, and mcp tools', () => {
    const parser = createClaudeStreamParser('t1');
    const events = parser.parseLine(
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', id: 'a', name: 'Edit', input: { file_path: 'src/a.ts' } },
            { type: 'tool_use', id: 'b', name: 'WebSearch', input: { query: 'docs' } },
            {
              type: 'tool_use',
              id: 'c',
              name: 'TodoWrite',
              input: { todos: [{ content: 'step 1', status: 'completed' }] },
            },
            { type: 'tool_use', id: 'd', name: 'mcp__linear__get_issue', input: {} },
            { type: 'tool_use', id: 'e', name: 'Read', input: { file_path: 'x' } },
          ],
        },
      })
    );
    expect(events.map((e) => (e.type === 'item' ? e.item.kind : e.type))).toEqual([
      'file_change',
      'web_search',
      'todo_list',
      'mcp_tool_call',
      'mcp_tool_call',
    ]);
    const mcp = events[3];
    expect(mcp.type === 'item' && mcp.item.kind === 'mcp_tool_call' && mcp.item.server).toBe(
      'linear'
    );
  });

  it('marks failed tool results as failed', () => {
    const parser = createClaudeStreamParser('t1');
    parser.parseLine(CLAUDE_TOOL_USE_LINE);
    const [event] = parser.parseLine(
      '{"type":"user","message":{"content":[{"tool_use_id":"toolu_01N","type":"tool_result","content":"permission denied","is_error":true}]}}'
    );
    expect(
      event.type === 'item' && event.item.kind === 'command_execution' && event.item.status
    ).toBe('failed');
  });

  it('completes on success results and fails on error results', () => {
    const parser = createClaudeStreamParser('t1');
    expect(parser.parseLine(CLAUDE_RESULT_LINE)).toEqual([{ type: 'turn-completed' }]);
    expect(
      parser.parseLine(
        '{"type":"result","subtype":"error_max_turns","is_error":true,"result":"max turns reached"}'
      )
    ).toEqual([{ type: 'turn-failed', message: 'max turns reached' }]);
  });

  it('ignores hooks, rate limits, blanks, and malformed JSON', () => {
    const parser = createClaudeStreamParser('t1');
    expect(
      parser.parseLine('{"type":"system","subtype":"hook_started","hook_name":"SessionStart"}')
    ).toEqual([]);
    expect(parser.parseLine('{"type":"rate_limit_event","rate_limit_info":{}}')).toEqual([]);
    expect(parser.parseLine('')).toEqual([]);
    expect(parser.parseLine('not json')).toEqual([]);
  });
});

describe('createPiStreamParser', () => {
  it('extracts the session id from the session event', () => {
    const parser = createPiStreamParser('t1');
    expect(
      parser.parseLine(
        '{"type":"session","id":"0dc5c1e2-f008-4594-a9b6-694037bedc88","cwd":"/tmp/x"}'
      )
    ).toEqual([{ type: 'thread-started', threadId: '0dc5c1e2-f008-4594-a9b6-694037bedc88' }]);
  });

  it('streams assistant text and thinking into stable item keys', () => {
    const parser = createPiStreamParser('t1');
    expect(
      parser.parseLine(
        '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","contentIndex":0,"delta":"Hel"}}'
      )
    ).toEqual([{ type: 'item', item: { kind: 'agent_message', key: 't1:p0', text: 'Hel' } }]);
    expect(
      parser.parseLine(
        '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","contentIndex":0,"delta":"lo"}}'
      )
    ).toEqual([{ type: 'item', item: { kind: 'agent_message', key: 't1:p0', text: 'Hello' } }]);
    expect(
      parser.parseLine(
        '{"type":"message_update","assistantMessageEvent":{"type":"thinking_delta","contentIndex":1,"delta":"Checking"}}'
      )
    ).toEqual([{ type: 'item', item: { kind: 'reasoning', key: 't1:p1', text: 'Checking' } }]);
  });

  it('maps bash tool execution updates and completion', () => {
    const parser = createPiStreamParser('t2');
    expect(
      parser.parseLine(
        '{"type":"tool_execution_start","toolCallId":"tool_1","toolName":"bash","args":{"command":"ls -la"}}'
      )
    ).toEqual([
      {
        type: 'item',
        item: {
          kind: 'command_execution',
          key: 't2:tool_1',
          command: 'ls -la',
          aggregatedOutput: '',
          exitCode: null,
          status: 'in_progress',
        },
      },
    ]);
    expect(
      parser.parseLine(
        '{"type":"tool_execution_update","toolCallId":"tool_1","partialResult":{"content":"total 0\\n"}}'
      )
    ).toEqual([
      {
        type: 'item',
        item: {
          kind: 'command_execution',
          key: 't2:tool_1',
          command: 'ls -la',
          aggregatedOutput: 'total 0\n',
          exitCode: null,
          status: 'in_progress',
        },
      },
    ]);
    expect(
      parser.parseLine(
        '{"type":"tool_execution_end","toolCallId":"tool_1","result":{"content":"total 0\\n","exitCode":0},"isError":false}'
      )
    ).toEqual([
      {
        type: 'item',
        item: {
          kind: 'command_execution',
          key: 't2:tool_1',
          command: 'ls -la',
          aggregatedOutput: 'total 0\n',
          exitCode: 0,
          status: 'completed',
        },
      },
    ]);
  });

  it('maps file tools and generic tools', () => {
    const parser = createPiStreamParser('t3');
    const write = parser.parseLine(
      '{"type":"tool_execution_start","toolCallId":"tool_2","toolName":"write","args":{"path":"src/a.ts"}}'
    );
    expect(write).toEqual([
      {
        type: 'item',
        item: {
          kind: 'file_change',
          key: 't3:tool_2',
          changes: [{ path: 'src/a.ts', kind: 'add' }],
          status: 'in_progress',
        },
      },
    ]);
    expect(
      parser.parseLine(
        '{"type":"tool_execution_end","toolCallId":"tool_2","result":{"content":"ok"},"isError":false}'
      )
    ).toEqual([
      {
        type: 'item',
        item: {
          kind: 'file_change',
          key: 't3:tool_2',
          changes: [{ path: 'src/a.ts', kind: 'add' }],
          status: 'completed',
        },
      },
    ]);

    expect(
      parser.parseLine(
        '{"type":"tool_execution_start","toolCallId":"tool_3","toolName":"read","args":{"path":"README.md"}}'
      )
    ).toEqual([
      {
        type: 'item',
        item: {
          kind: 'mcp_tool_call',
          key: 't3:tool_3',
          server: '',
          tool: 'read',
          status: 'in_progress',
        },
      },
    ]);
  });

  it('handles lifecycle, errors, blanks, and malformed JSON', () => {
    const parser = createPiStreamParser('t4');
    expect(parser.parseLine('{"type":"agent_start"}')).toEqual([{ type: 'turn-started' }]);
    expect(parser.parseLine('{"type":"agent_end"}')).toEqual([{ type: 'turn-completed' }]);
    expect(
      parser.parseLine(
        '{"type":"message_update","assistantMessageEvent":{"type":"error","reason":"boom"}}'
      )
    ).toEqual([{ type: 'turn-failed', message: 'boom' }]);
    expect(
      parser.parseLine('{"type":"auto_retry_end","success":false,"finalError":"still broken"}')
    ).toEqual([{ type: 'turn-failed', message: 'still broken' }]);
    expect(parser.parseLine('')).toEqual([]);
    expect(parser.parseLine('not json')).toEqual([]);
    expect(parser.parseLine('[1,2,3]')).toEqual([]);
  });
});
