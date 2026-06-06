import { describe, expect, it } from 'vitest';
import { createPiStreamParser } from './pi-exec-events';

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
