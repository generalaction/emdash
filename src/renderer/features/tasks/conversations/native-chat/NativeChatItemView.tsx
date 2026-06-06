import {
  CheckIcon,
  ChevronRightIcon,
  CircleSlashIcon,
  FilePenLineIcon,
  GlobeIcon,
  TerminalIcon,
  WrenchIcon,
} from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { MarkdownRenderer } from '@renderer/lib/ui/markdown-renderer';
import { Spinner } from '@renderer/lib/ui/spinner';
import { cn } from '@renderer/utils/utils';
import type { NativeChatItem } from '@shared/native-chat';
import {
  formatTurnDuration,
  summarizeActivity,
  type ActivityChatItem,
} from './native-chat-transcript';

export function UserMessageView({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-lg bg-background-2 px-3 py-1.5 text-sm whitespace-pre-wrap text-foreground">
        {text}
      </div>
    </div>
  );
}

export function AgentMessageView({ text }: { text: string }) {
  return (
    <div className="text-sm leading-relaxed">
      <MarkdownRenderer content={text} variant="compact" />
    </div>
  );
}

export function SystemNoteView({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-3" role="status">
      <div className="h-px flex-1 bg-border/60" />
      <span className="flex items-center gap-1 text-micro tracking-wider text-foreground-passive uppercase">
        <CircleSlashIcon className="h-2.5 w-2.5" />
        {text}
      </span>
      <div className="h-px flex-1 bg-border/60" />
    </div>
  );
}

const FILE_CHANGE_GLYPHS: Record<string, { glyph: string; className: string }> = {
  add: { glyph: '+', className: 'text-foreground-diff-added' },
  delete: { glyph: '−', className: 'text-foreground-diff-deleted' },
  update: { glyph: '±', className: 'text-foreground-diff-modified' },
};

function stripEmphasis(text: string): string {
  return text.replace(/\*\*/g, '').trim();
}

function CommandRow({ item }: { item: Extract<ActivityChatItem, { kind: 'command_execution' }> }) {
  const [showOutput, setShowOutput] = useState(false);
  const failed = item.status !== 'in_progress' && item.exitCode !== null && item.exitCode !== 0;
  const hasOutput = item.aggregatedOutput.length > 0;

  return (
    <div>
      <button
        type="button"
        onClick={() => hasOutput && setShowOutput((v) => !v)}
        disabled={!hasOutput}
        className={cn(
          'flex w-full min-w-0 items-center gap-2 rounded-sm px-2 py-1 text-left',
          hasOutput && 'hover:bg-background-1'
        )}
      >
        <TerminalIcon className="h-3 w-3 shrink-0 text-foreground-passive" />
        <code className="min-w-0 flex-1 truncate font-mono text-code text-foreground-muted">
          {item.command}
        </code>
        {item.status === 'in_progress' ? (
          <Spinner size="sm" className="h-3 w-3 shrink-0 text-foreground-passive" />
        ) : failed ? (
          <span className="shrink-0 font-mono text-tiny text-foreground-destructive">
            exit {item.exitCode}
          </span>
        ) : null}
      </button>
      {showOutput && hasOutput && (
        <pre className="mx-2 mb-1.5 max-h-56 overflow-auto rounded-md bg-background-1 px-2.5 py-2 font-mono text-code whitespace-pre-wrap text-foreground-muted">
          {item.aggregatedOutput}
        </pre>
      )}
    </div>
  );
}

function ActivityRow({ item }: { item: ActivityChatItem }) {
  switch (item.kind) {
    case 'command_execution':
      return <CommandRow item={item} />;
    case 'reasoning': {
      const text = stripEmphasis(item.text);
      if (!text) return null;
      return (
        <div className="px-2 py-1 text-xs leading-snug text-foreground-passive">
          <span className="line-clamp-2">{text}</span>
        </div>
      );
    }
    case 'file_change':
      return (
        <div className="flex flex-col gap-0.5 px-2 py-1">
          {item.changes.map((change) => {
            const glyph = FILE_CHANGE_GLYPHS[change.kind] ?? FILE_CHANGE_GLYPHS.update;
            return (
              <div key={change.path} className="flex min-w-0 items-center gap-2">
                <FilePenLineIcon className="h-3 w-3 shrink-0 text-foreground-passive" />
                <code className="min-w-0 truncate font-mono text-code text-foreground-muted">
                  {change.path}
                </code>
                <span className={cn('shrink-0 font-mono text-code', glyph.className)}>
                  {glyph.glyph}
                </span>
              </div>
            );
          })}
        </div>
      );
    case 'mcp_tool_call':
      return (
        <div className="flex min-w-0 items-center gap-2 px-2 py-1">
          <WrenchIcon className="h-3 w-3 shrink-0 text-foreground-passive" />
          <code className="min-w-0 truncate font-mono text-code text-foreground-muted">
            {item.server}
            {item.server && item.tool ? '.' : ''}
            {item.tool}
          </code>
          {item.status === 'in_progress' && (
            <Spinner size="sm" className="h-3 w-3 shrink-0 text-foreground-passive" />
          )}
        </div>
      );
    case 'web_search':
      return (
        <div className="flex min-w-0 items-center gap-2 px-2 py-1 text-xs text-foreground-muted">
          <GlobeIcon className="h-3 w-3 shrink-0 text-foreground-passive" />
          <span className="min-w-0 truncate">{item.query}</span>
        </div>
      );
    case 'todo_list':
      return (
        <div className="flex flex-col gap-0.5 px-2 py-1">
          {item.items.map((todo, index) => (
            <div key={index} className="flex min-w-0 items-center gap-2 text-xs">
              <CheckIcon
                className={cn(
                  'h-3 w-3 shrink-0',
                  todo.completed ? 'text-foreground-success' : 'text-foreground-passive/40'
                )}
              />
              <span
                className={cn(
                  'min-w-0 truncate text-foreground-muted',
                  todo.completed && 'text-foreground-passive line-through'
                )}
              >
                {todo.text}
              </span>
            </div>
          ))}
        </div>
      );
    case 'error':
      return (
        <div className="px-2 py-1 text-xs whitespace-pre-wrap text-foreground-destructive">
          {item.message}
        </div>
      );
  }
}

function activityHeading(items: ActivityChatItem[], durationMs?: number): string {
  const summary = summarizeActivity(items);
  if (durationMs === undefined) return summary;
  const duration = formatTurnDuration(durationMs);
  if (summary === 'Thought') return `Thought for ${duration}`;
  return `Worked for ${duration} · ${summary}`;
}

/**
 * A run of agent work between messages. Live groups stay open so the user can
 * watch commands stream; once the turn moves on, the group folds into a
 * one-line summary ("Worked for 12s · 3 commands").
 */
export function ActivityGroupView({
  items,
  live,
  durationMs,
}: {
  items: ActivityChatItem[];
  live: boolean;
  durationMs?: number;
}) {
  const [expanded, setExpanded] = useState(live);
  const wasLive = useRef(live);

  useEffect(() => {
    if (wasLive.current && !live) setExpanded(false);
    if (!wasLive.current && live) setExpanded(true);
    wasLive.current = live;
  }, [live]);

  return (
    <div className="overflow-hidden rounded-lg border border-border/60">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex h-7 w-full items-center gap-1.5 px-2 text-left text-xs text-foreground-muted transition-colors hover:bg-background-1"
      >
        <ChevronRightIcon
          className={cn(
            'h-3 w-3 shrink-0 text-foreground-passive transition-transform duration-150',
            expanded && 'rotate-90'
          )}
        />
        <span className="min-w-0 flex-1 truncate">
          {live ? summarizeActivity(items) : activityHeading(items, durationMs)}
        </span>
        {live && (
          <span
            aria-label="Working"
            className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-status-in-progress"
          />
        )}
      </button>
      {expanded && (
        <div className="border-t border-border/50 py-0.5">
          {items.map((item) => (
            <ActivityRow key={item.key} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

export function ChatItemView({ item }: { item: NativeChatItem }) {
  switch (item.kind) {
    case 'user_message':
      return <UserMessageView text={item.text} />;
    case 'agent_message':
      return <AgentMessageView text={item.text} />;
    case 'system':
      return <SystemNoteView text={item.text} />;
    default:
      return null;
  }
}
