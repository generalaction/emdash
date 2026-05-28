import {
  AlertCircle,
  Brain,
  CheckCircle2,
  CircleDashed,
  Clock,
  Shield,
  Wrench,
} from 'lucide-react';
import { Badge } from '@renderer/lib/ui/badge';
import { MarkdownRenderer } from '@renderer/lib/ui/markdown-renderer';
import { cn } from '@renderer/utils/utils';
import type { ChatRenderItem } from './chat-render-model';

interface ChatMessageProps {
  item: ChatRenderItem;
}

export function ChatMessage({ item }: ChatMessageProps) {
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
    return (
      <div className="flex justify-start">
        <article className="max-w-[82%] rounded-md border border-border bg-background-secondary-1 px-3 py-2 text-sm">
          <div className="flex items-center gap-2">
            <Wrench className="size-3.5 text-foreground-muted" />
            <span className="font-medium text-foreground">{item.item.toolName}</span>
            <StatusBadge status={item.item.status} />
          </div>
          {item.item.error ? (
            <p className="text-destructive mt-2 text-xs break-words whitespace-pre-wrap">
              {item.item.error}
            </p>
          ) : item.item.output ? (
            <p className="mt-2 line-clamp-4 text-xs break-words whitespace-pre-wrap text-foreground-secondary">
              {item.item.output}
            </p>
          ) : null}
        </article>
      </div>
    );
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
