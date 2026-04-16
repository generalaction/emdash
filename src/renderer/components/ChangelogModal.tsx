import { Badge } from '@/components/ui/badge';
import { BaseModalProps } from '@/contexts/ModalProvider';
import { MarkdownRenderer } from '@/components/ui/markdown-renderer';
import { DialogContent } from '@/components/ui/dialog';
import { formatChangelogPublishedAt } from '@/lib/changelogDate';
import { EMDASH_CHANGELOG_URL, type ChangelogEntry } from '@shared/changelog';
import { EMDASH_WEBSITE_URL } from '@shared/urls';
import { ArrowRight, ExternalLink } from 'lucide-react';

interface ChangelogModalProps {
  entry: ChangelogEntry;
}

export function ChangelogModalOverlay({ entry }: BaseModalProps<void> & ChangelogModalProps) {
  return <ChangelogModal entry={entry} />;
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

const FOOTER_PATTERN =
  /^(?:#{1,6}\s*new\s+contributors|[\s*-]*@\S+\s+made\s+their\s+first\s+contribution|\*{0,2}full\s+changelog\*{0,2}\s*:)/im;

function splitContentFooter(content: string): { main: string; footer: string } {
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (FOOTER_PATTERN.test(lines[i])) {
      return {
        main: lines.slice(0, i).join('\n').trim(),
        footer: lines.slice(i).join('\n').trim(),
      };
    }
  }
  return { main: content, footer: '' };
}

function ChangelogModal({ entry }: ChangelogModalProps): JSX.Element {
  const publishedAt = formatChangelogPublishedAt(entry.publishedAt);
  const content = stripLeadingReleaseHeadings(entry.content, entry);
  const { main, footer } = splitContentFooter(content);

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

      <div className="max-h-[min(75vh,44rem)] overflow-y-auto">
        <div className="px-6 py-5">
          <button
            type="button"
            onClick={() => window.electronAPI.openExternal(EMDASH_WEBSITE_URL)}
            className="flex w-full items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/35 px-4 py-3 text-left transition-colors hover:bg-accent/40"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">Emdash v1 is in public beta</p>
              <p className="mt-0.5 text-sm text-muted-foreground">Download the beta</p>
            </div>
            <ArrowRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
          </button>
          {publishedAt && (
            <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1">
              <Badge variant="outline" className="h-5 px-2 text-[11px] font-medium">
                {publishedAt}
              </Badge>
            </div>
          )}
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-foreground">
            {entry.title}
          </h2>
          {entry.image && (
            <div className="mt-4 overflow-hidden rounded-lg">
              <img
                src={entry.image}
                alt={`${entry.title} screenshot`}
                className="h-auto w-full object-cover"
                loading="lazy"
              />
            </div>
          )}
          {entry.summary && (
            <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground">
              {entry.summary}
            </p>
          )}
          <div className="mt-6">
            <MarkdownRenderer content={main} />
          </div>
          {footer && (
            <div className="mt-6 border-t border-border pt-5">
              <MarkdownRenderer content={footer} />
            </div>
          )}
        </div>
      </div>
    </DialogContent>
  );
}
