import type { SessionUpdate } from '@agentclientprotocol/sdk';
import { AcpTranscriptParser, type NormalizedEvent } from '@emdash/core/runtimes/acp/api';
import { describe, expect, it } from 'vitest';
import { enrichClaudeUpdate } from './acp-transform';

// Shape and text from the reported conversation; identifiers are replaced.
const monitor = `<task-notification>
<task-id>monitor-1</task-id>
<summary>Monitor event: "main benchmark step results"</summary>
<event>[Monitor expired after 30m with 12 events delivered. Re-arm it if you still need the watch.]</event>
</task-notification>`;

function raw(text: string): SessionUpdate {
  return { sessionUpdate: 'user_message_chunk', content: { type: 'text', text } };
}

function enrich(text: string, extra: Partial<Extract<NormalizedEvent, { kind: 'message' }>> = {}) {
  const message: NormalizedEvent = {
    kind: 'message',
    role: 'user',
    messageId: null,
    text,
    ...extra,
  };
  return { message, result: enrichClaudeUpdate(message, raw(text)) };
}

describe('Claude background notifications', () => {
  it('recognizes the reported monitor event without a tool ID or status', () => {
    expect(enrich(monitor).result).toEqual({
      kind: 'notification',
      title: 'Monitor event: "main benchmark step results"',
      text: '[Monitor expired after 30m with 12 events delivered. Re-arm it if you still need the watch.]',
    });
  });

  it('does not turn the reported notification into a user turn or a running agent', () => {
    const parser = new AcpTranscriptParser({
      conversationId: 'report',
      enrich: enrichClaudeUpdate,
    });
    parser.push(raw('Compare performance on main'), 0);
    parser.push(
      { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Results' } },
      1
    );
    parser.endTurn(2);
    parser.push(raw(monitor), 3);
    expect(parser.activeTurn).toBeNull();
    expect(parser.history).toHaveLength(1);
    expect(parser.history[0].items.map((item) => item.kind)).toEqual([
      'message',
      'message',
      'notification',
    ]);
    expect(parser.agents).toEqual([]);
  });

  it.each(['pending', 'in_progress', 'completed', 'failed'])(
    'preserves known subagent status %s',
    (status) => {
      const text = `<task-notification><task-id>a</task-id><tool-use-id>t</tool-use-id><status>${status}</status><summary>Agent update</summary><output-file>/tmp/output</output-file></task-notification>`;
      expect(enrich(text).result).toEqual({
        kind: 'subagent_update',
        agentId: 'a',
        toolCallId: 't',
        status,
        summary: 'Agent update',
        outputFile: '/tmp/output',
      });
    }
  );

  it.each(['stopped', 'future-status', ''])(
    'does not invent a running agent for status %j',
    (status) => {
      const text = `<task-notification><task-id>shell</task-id><tool-use-id>tool</tool-use-id><status>${status}</status><summary>Background shell ended</summary><note>Check partial results.</note><output-file>/tmp/output</output-file></task-notification>`;
      const result = enrich(text).result;
      expect(result).toMatchObject({ kind: 'notification', title: 'Background shell ended' });
      expect(result).toHaveProperty(
        'text',
        [status && `Status: ${status}`, 'Check partial results.', 'Output: /tmp/output']
          .filter(Boolean)
          .join('\n\n')
      );
    }
  );

  it('treats monitor events as notifications even with tool correlation metadata', () => {
    const text = monitor.replace(
      '<task-id>',
      '<tool-use-id>tool</tool-use-id><status>completed</status><task-id>'
    );
    expect(enrich(text).result.kind).toBe('notification');
  });

  it('preserves multiline event content as literal text', () => {
    const text = monitor.replace(
      /<event>[\s\S]*?<\/event>/,
      '<event>first\n<script>danger()</script>\n**literal** & text\n<command-name>/model</command-name></event>'
    );
    expect(enrich(text).result).toMatchObject({
      kind: 'notification',
      text: 'first\n<script>danger()</script>\n**literal** & text\n<command-name>/model</command-name>',
    });
  });

  it('accepts surrounding whitespace and CRLF envelopes', () => {
    expect(enrich(` \r\n${monitor.replaceAll('\n', '\r\n')}\r\n `).result).toEqual(
      enrich(monitor).result
    );
  });

  it('supplies a title when only event content is present', () => {
    expect(
      enrich('<task-notification><task-id>a</task-id><event>Finished</event></task-notification>')
        .result
    ).toEqual({ kind: 'notification', title: 'Background task update', text: 'Finished' });
  });

  it.each([
    ['prefix prose', `Please explain ${monitor}`],
    ['suffix prose', `${monitor}\nAnd run this next`],
    ['code fence', `\`\`\`xml\n${monitor}\n\`\`\``],
    [
      'unknown field',
      monitor.replace('</task-notification>', '<future>Keep me</future></task-notification>'),
    ],
    [
      'duplicate field',
      monitor.replace('</task-notification>', '<event>Keep both</event></task-notification>'),
    ],
    ['missing task ID', monitor.replace('<task-id>monitor-1</task-id>', '')],
    ['empty task ID', monitor.replace('monitor-1', ' ')],
    ['missing content', '<task-notification><task-id>a</task-id></task-notification>'],
    ['unclosed field', monitor.replace('</event>', '')],
    ['multiple envelopes', `${monitor}\n${monitor}`],
  ])('leaves %s untouched rather than losing content', (_label, text) => {
    const { message, result } = enrich(text);
    expect(result).toBe(message);
  });

  it.each([
    { role: 'assistant' as const },
    { promptId: 'accepted-user-prompt' },
    { attachments: [{ id: 'image', name: 'photo.png', mimeType: 'image/png' as const }] },
  ])('keeps explicit conversational content intact (%j)', (extra) => {
    const { message, result } = enrich(monitor, extra);
    expect(result).toBe(message);
  });

  it('preserves all content when the provider splits the envelope at any boundary', () => {
    for (let split = 1; split < monitor.length; split++) {
      const parser = new AcpTranscriptParser({
        conversationId: 'split',
        enrich: enrichClaudeUpdate,
      });
      parser.push(raw(monitor.slice(0, split)), 0);
      parser.push(raw(monitor.slice(split)), 1);
      parser.endTurn(2);
      expect(
        parser.history
          .flatMap((turn) => turn.items)
          .map((item) => ('text' in item ? item.text : ''))
          .join('')
      ).toBe(monitor);
    }
  });

  it('produces the same typed notice on live and replay paths', () => {
    const updates: SessionUpdate[] = [
      raw('Compare main'),
      { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Results' } },
      raw(monitor),
    ];
    const deps = { conversationId: 'parity', enrich: enrichClaudeUpdate };
    const live = new AcpTranscriptParser(deps);
    updates.forEach((update, i) => live.push(update, i));
    live.endTurn(5);
    const replay = AcpTranscriptParser.replay(updates, deps);
    expect(replay.committed).toEqual(live.history);
    expect(replay.active).toBeNull();
    expect(replay.agents).toEqual([]);
  });
});
