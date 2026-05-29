import {
  AlertCircle,
  Brain,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  CircleDashed,
  Clock,
  Shield,
  Wrench,
} from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';
import { MarkdownRenderer } from '@renderer/lib/ui/markdown-renderer';
import { Textarea } from '@renderer/lib/ui/textarea';
import { cn } from '@renderer/utils/utils';
import type { ConversationPermissionResponse } from '@shared/conversation-timeline';
import type { ChatRenderItem } from './chat-render-model';

interface ChatMessageProps {
  item: ChatRenderItem;
  permissionResponsesEnabled?: boolean;
  onRespondToPermission?: (response: ConversationPermissionResponse) => Promise<void>;
}

export function ChatMessage({
  item,
  permissionResponsesEnabled = false,
  onRespondToPermission,
}: ChatMessageProps) {
  if (item.kind === 'message') {
    const isUser = item.role === 'user';
    return (
      <div className={cn('flex w-full', isUser ? 'justify-end' : 'justify-start')}>
        <article
          className={cn(
            'max-w-[82%] rounded-md border px-3 py-2 text-sm shadow-xs',
            isUser
              ? 'border-primary-button-border bg-primary-button-background text-primary-button-foreground'
              : 'border-border bg-background-secondary-1 text-foreground'
          )}
        >
          {isUser ? (
            <p className="break-words whitespace-pre-wrap">{item.text}</p>
          ) : (
            <MarkdownRenderer
              content={item.text}
              variant="compact"
              allowHtml={false}
              className="max-w-none text-sm leading-6 break-words"
            />
          )}
        </article>
      </div>
    );
  }

  if (item.kind === 'reasoning') {
    return (
      <div className="flex justify-start">
        <article className="max-w-[82%] rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground-secondary">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-foreground-muted">
            <Brain className="size-3.5" />
            <span>Reasoning</span>
          </div>
          <p className="break-words whitespace-pre-wrap">{item.text}</p>
        </article>
      </div>
    );
  }

  if (item.kind === 'tool_call') {
    return <ToolCallMessage item={item} />;
  }

  if (item.kind === 'permission_request') {
    return (
      <div className="flex justify-start">
        <article className="max-w-[82%] rounded-md border border-border bg-background-secondary-1 px-3 py-2 text-sm">
          <div className="flex items-center gap-2">
            <Shield className="size-3.5 text-foreground-muted" />
            <span className="font-medium text-foreground">{item.item.title}</span>
            <StatusBadge status={item.item.status} />
          </div>
          {item.item.body ? (
            <p className="mt-2 text-xs break-words whitespace-pre-wrap text-foreground-secondary">
              {item.item.body}
            </p>
          ) : null}
          <PermissionActions
            item={item}
            enabled={permissionResponsesEnabled}
            onRespondToPermission={onRespondToPermission}
          />
        </article>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <article className="max-w-[82%] rounded-md border border-border-destructive bg-background-destructive px-3 py-2 text-sm text-foreground-destructive">
        <div className="mb-1 flex items-center gap-1.5 text-xs font-medium">
          <AlertCircle className="size-3.5" />
          <span>Error</span>
        </div>
        <p className="break-words whitespace-pre-wrap">{item.item.message}</p>
      </article>
    </div>
  );
}

function ToolCallMessage({ item }: { item: Extract<ChatRenderItem, { kind: 'tool_call' }> }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails =
    item.item.input !== undefined || Boolean(item.item.output?.trim()) || Boolean(item.item.error);
  const summary = item.item.error ?? item.item.output;

  return (
    <div className="flex justify-start">
      <article className="max-w-[82%] rounded-md border border-border bg-background-secondary-1 px-3 py-2 text-sm">
        <div className="flex items-center gap-2">
          {hasDetails ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={expanded ? 'Collapse tool call' : 'Expand tool call'}
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
            </Button>
          ) : (
            <Wrench className="size-3.5 text-foreground-muted" />
          )}
          <span className="font-medium text-foreground">{item.item.toolName}</span>
          <StatusBadge status={item.item.status} />
        </div>
        {!expanded && summary ? (
          <p
            className={cn(
              'mt-2 line-clamp-4 text-xs break-words whitespace-pre-wrap',
              item.item.error ? 'text-foreground-destructive' : 'text-foreground-secondary'
            )}
          >
            {summary}
          </p>
        ) : null}
        {expanded ? (
          <div className="mt-2 space-y-2 text-xs text-foreground-secondary">
            {item.item.input !== undefined ? (
              <pre className="max-h-48 overflow-auto rounded-md border border-border bg-background px-2 py-1.5 whitespace-pre-wrap">
                {formatToolInput(item.item.input)}
              </pre>
            ) : null}
            {item.item.output ? (
              <pre className="max-h-48 overflow-auto rounded-md border border-border bg-background px-2 py-1.5 whitespace-pre-wrap">
                {item.item.output}
              </pre>
            ) : null}
            {item.item.error ? (
              <p className="break-words whitespace-pre-wrap text-foreground-destructive">
                {item.item.error}
              </p>
            ) : null}
          </div>
        ) : null}
      </article>
    </div>
  );
}

function PermissionActions({
  item,
  enabled,
  onRespondToPermission,
}: {
  item: Extract<ChatRenderItem, { kind: 'permission_request' }>;
  enabled: boolean;
  onRespondToPermission?: (response: ConversationPermissionResponse) => Promise<void>;
}) {
  const questions = getPermissionQuestions(item.item.input);
  const [answers, setAnswers] = useState<Record<string, string | string[]>>(() =>
    Object.fromEntries(
      questions.map((question) => [
        question.id,
        question.multiSelect ? [] : (question.options?.[0]?.label ?? ''),
      ])
    )
  );
  const [pendingOptionId, setPendingOptionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const disabled =
    item.item.status !== 'pending' ||
    !enabled ||
    pendingOptionId !== null ||
    onRespondToPermission === undefined;

  const respond = async (optionId: string) => {
    if (disabled || !onRespondToPermission) return;
    setPendingOptionId(optionId);
    setError(null);
    try {
      await onRespondToPermission({
        answers: optionId === 'approve' && questions.length > 0 ? answers : undefined,
        requestId: item.item.requestId,
        optionId,
      });
    } catch (respondError) {
      setError(respondError instanceof Error ? respondError.message : String(respondError));
    } finally {
      setPendingOptionId(null);
    }
  };

  if (item.item.options.length === 0) return null;

  return (
    <div className="mt-3 space-y-2">
      {questions.length > 0 && item.item.status === 'pending' ? (
        <div className="space-y-2">
          {questions.map((question) => (
            <label key={question.id} className="block space-y-1.5">
              <span className="block text-xs font-medium text-foreground-secondary">
                {question.header ?? question.question ?? question.id}
              </span>
              {question.question && question.header ? (
                <span className="block text-xs text-foreground-muted">{question.question}</span>
              ) : null}
              {question.options && question.options.length > 0 && question.multiSelect ? (
                <div className="space-y-1">
                  {question.options.map((option) => {
                    const selected = new Set(
                      Array.isArray(answers[question.id]) ? answers[question.id] : []
                    );
                    return (
                      <label key={option.label} className="flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          disabled={disabled}
                          checked={selected.has(option.label)}
                          onChange={(event) =>
                            setAnswers((current) => {
                              const currentSelected = new Set(
                                Array.isArray(current[question.id]) ? current[question.id] : []
                              );
                              if (event.target.checked) {
                                currentSelected.add(option.label);
                              } else {
                                currentSelected.delete(option.label);
                              }
                              return { ...current, [question.id]: Array.from(currentSelected) };
                            })
                          }
                        />
                        <span>{option.label}</span>
                      </label>
                    );
                  })}
                </div>
              ) : question.options && question.options.length > 0 ? (
                <select
                  className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground"
                  disabled={disabled}
                  value={typeof answers[question.id] === 'string' ? answers[question.id] : ''}
                  onChange={(event) =>
                    setAnswers((current) => ({ ...current, [question.id]: event.target.value }))
                  }
                >
                  {question.options.map((option) => (
                    <option key={option.label} value={option.label}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : (
                <Textarea
                  className="min-h-16 bg-background text-xs"
                  disabled={disabled}
                  value={answers[question.id] ?? ''}
                  onChange={(event) =>
                    setAnswers((current) => ({ ...current, [question.id]: event.target.value }))
                  }
                />
              )}
            </label>
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {item.item.options.map((option) => (
          <Button
            key={option.id}
            type="button"
            size="xs"
            variant={option.kind === 'danger' ? 'destructive' : 'secondary'}
            disabled={disabled}
            onClick={() => void respond(option.id)}
          >
            {pendingOptionId === option.id ? 'Sending' : option.label}
          </Button>
        ))}
      </div>
      {error ? (
        <p role="alert" className="text-xs text-foreground-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

type PermissionQuestion = {
  id: string;
  header?: string;
  question?: string;
  multiSelect?: boolean;
  options?: Array<{ label: string; description?: string }>;
};

function getPermissionQuestions(input: unknown): PermissionQuestion[] {
  if (typeof input !== 'object' || input === null || !('questions' in input)) return [];
  const questions = (input as { questions?: unknown }).questions;
  if (!Array.isArray(questions)) return [];
  return questions.filter((question): question is PermissionQuestion => {
    if (typeof question !== 'object' || question === null) return false;
    if (!('id' in question) || typeof question.id !== 'string') return false;
    if (
      'options' in question &&
      question.options !== undefined &&
      !Array.isArray(question.options)
    ) {
      return false;
    }
    return true;
  });
}

function StatusBadge({ status }: { status: string }) {
  const icon =
    status === 'completed' || status === 'approved' ? (
      <CheckCircle2 className="size-3" />
    ) : status === 'running' || status === 'pending' ? (
      <Clock className="size-3" />
    ) : (
      <CircleDashed className="size-3" />
    );
  const variant = status === 'failed' || status === 'denied' ? 'destructive' : 'secondary';

  return (
    <Badge variant={variant} className="capitalize">
      {icon}
      {status.replace('-', ' ')}
    </Badge>
  );
}

function formatToolInput(input: unknown): string {
  if (typeof input === 'string') return input;
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}
