import { describe, expect, it } from 'vitest';
import { createClaudeStreamParser } from './claude-exec-events';

// Shapes sampled from a real `claude -p --output-format stream-json --verbose` run.
const INIT_LINE =
  '{"type":"system","subtype":"init","cwd":"/tmp/x","session_id":"49df8b52-4204-4043-93c8-3eaca858922a","tools":["Bash"],"model":"claude-opus-4-8","permissionMode":"default"}';

const TOOL_USE_LINE =
  '{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_01N","name":"Bash","input":{"command":"ls -la","description":"List files"}}]},"session_id":"49df8b52"}';

const TOOL_RESULT_LINE =
  '{"type":"user","message":{"role":"user","content":[{"tool_use_id":"toolu_01N","type":"tool_result","content":"total 0\\nfile.txt","is_error":false}]},"session_id":"49df8b52"}';

const TEXT_LINE =
  '{"type":"assistant","message":{"role":"assistant","content":[{"type":"thinking","thinking":"Let me check.","signature":"x"},{"type":"text","text":"There are 2 entries."}]},"session_id":"49df8b52"}';

const RESULT_LINE =
  '{"type":"result","subtype":"success","is_error":false,"duration_ms":6296,"num_turns":2,"result":"There are 2 entries.","session_id":"49df8b52-4204-4043-93c8-3eaca858922a"}';

describe('createClaudeStreamParser', () => {
  it('extracts the session id from init', () => {
    const parser = createClaudeStreamParser('t1');
    expect(parser.parseLine(INIT_LINE)).toEqual([
      { type: 'thread-started', threadId: '49df8b52-4204-4043-93c8-3eaca858922a' },
    ]);
  });

  it('maps Bash tool_use and completes it from the matching tool_result', () => {
    const parser = createClaudeStreamParser('t1');
    const started = parser.parseLine(TOOL_USE_LINE);
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

    const completed = parser.parseLine(TOOL_RESULT_LINE);
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
    expect(parser.parseLine(TEXT_LINE)).toEqual([
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
    parser.parseLine(TOOL_USE_LINE);
    const [event] = parser.parseLine(
      '{"type":"user","message":{"content":[{"tool_use_id":"toolu_01N","type":"tool_result","content":"permission denied","is_error":true}]}}'
    );
    expect(
      event.type === 'item' && event.item.kind === 'command_execution' && event.item.status
    ).toBe('failed');
  });

  it('completes on success results and fails on error results', () => {
    const parser = createClaudeStreamParser('t1');
    expect(parser.parseLine(RESULT_LINE)).toEqual([{ type: 'turn-completed' }]);
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
