import { BaseModalProps } from '@/contexts/ModalProvider';
import { MarkdownRenderer } from '@/components/ui/markdown-renderer';
import { DialogContent } from '@/components/ui/dialog';
import { EMDASH_CHANGELOG_URL, type ChangelogEntry } from '@shared/changelog';
import { ExternalLink } from 'lucide-react';

interface ChangelogModalProps {
  entry: ChangelogEntry;
}

export function ChangelogModalOverlay({ entry }: BaseModalProps<void> & ChangelogModalProps) {
  return <ChangelogModal entry={entry} />;
}

function formatPublishedAt(value?: string): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
  }).format(parsed);
}

function normalizeLeadLine(value: string): string {
  return value
    .replace(/^#+\s*/, '')
    .replace(/[^a-zA-Z0-9.]/g, '')
    .replace(/\s+/g, '')
    .trim()
    .toLowerCase();
}

function stripLeadingReleaseHeadings(content: string, entry: ChangelogEntry): string {
  const lines = content.split('\n');
  const normalizedVersion = normalizeLeadLine(`v${entry.version}`);
  const normalizedTitle = normalizeLeadLine(entry.title);
  const redundantLeads = new Set([
    normalizedVersion,
    normalizeLeadLine(entry.version),
    normalizeLeadLine("What's Changed"),
    normalizeLeadLine(`v${entry.version} What's Changed`),
    normalizeLeadLine(`${entry.version} What's Changed`),
    normalizedTitle + normalizeLeadLine("What's Changed"),
  ]);

  while (lines.length > 0) {
    const line = lines[0].trim();
    if (!line) {
      lines.shift();
      continue;
    }

    const normalizedLine = normalizeLeadLine(line);
    if (redundantLeads.has(normalizedLine) || normalizedLine === normalizedTitle) {
      lines.shift();
      continue;
    }

    break;
  }

  return lines.join('\n').trim();
}

function ChangelogModal({ entry }: ChangelogModalProps): JSX.Element {
  const publishedAt = formatPublishedAt(entry.publishedAt);
  const content = stripLeadingReleaseHeadings(entry.content, entry);

  return (
    <DialogContent className="max-w-2xl gap-0 overflow-hidden p-0 focus:outline-none">
      <div className="border-b border-border px-6 py-4 pr-14">
        <button
          type="button"
          onClick={() => window.electronAPI.openExternal(EMDASH_CHANGELOG_URL)}
          className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          View full changelog <ExternalLink className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="max-h-[min(75vh,44rem)] overflow-y-auto px-6 py-5">
        {publishedAt && (
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            {publishedAt}
          </p>
        )}
        <h2 className="mt-3 text-2xl font-semibold tracking-tight text-foreground">
          {entry.title}
        </h2>
        {entry.summary && (
          <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground">{entry.summary}</p>
        )}
        <div className="mt-6">
          <MarkdownRenderer content={content} />
        </div>
      </div>
    </DialogContent>
  );
}
