import {
  compareChangelogVersions,
  EMDASH_CHANGELOG_API_URL,
  EMDASH_CHANGELOG_URL,
  normalizeChangelogVersion,
  type ChangelogEntry,
} from '@shared/changelog';
import { log } from '../lib/logger';

type ChangelogCandidate = {
  version?: string | null;
  title?: string | null;
  summary?: string | null;
  content?: string | null;
  contentHtml?: string | null;
  markdown?: string | null;
  body?: string | null;
  html?: string | null;
  publishedAt?: string | null;
  published_at?: string | null;
  date?: string | null;
  url?: string | null;
  href?: string | null;
};

function firstString(...values: Array<unknown>): string | undefined {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'");
}

function stripTags(input: string): string {
  return decodeHtmlEntities(input.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function htmlToMarkdown(html: string): string {
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  const withLinks = withoutScripts.replace(
    /<a\b[^>]*href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi,
    (_match, _quote, href: string, text: string) => {
      const label = stripTags(text);
      return label ? `[${label}](${href.trim()})` : '';
    }
  );

  const withFormatting = withLinks
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_match, _tag, text: string) => {
      const content = stripTags(text);
      return content ? `**${content}**` : '';
    })
    .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_match, _tag, text: string) => {
      const content = stripTags(text);
      return content ? `*${content}*` : '';
    })
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_match, text: string) => {
      const content = stripTags(text);
      return content ? `\`${content}\`` : '';
    });

  const withHeadings = withFormatting
    .replace(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n')
    .replace(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n')
    .replace(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n')
    .replace(/<h4\b[^>]*>([\s\S]*?)<\/h4>/gi, '\n#### $1\n')
    .replace(/<h5\b[^>]*>([\s\S]*?)<\/h5>/gi, '\n##### $1\n')
    .replace(/<h6\b[^>]*>([\s\S]*?)<\/h6>/gi, '\n###### $1\n');

  const withLists = withHeadings
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, '\n- $1')
    .replace(/<\/(ul|ol)>/gi, '\n')
    .replace(/<(ul|ol)\b[^>]*>/gi, '\n');

  const withParagraphs = withLists
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<p\b[^>]*>/gi, '')
    .replace(/<\/div>/gi, '\n')
    .replace(/<div\b[^>]*>/gi, '\n');

  return decodeHtmlEntities(withParagraphs.replace(/<[^>]+>/g, ' '))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/ {2,}/g, ' ')
    .trim();
}

function extractSummaryFromContent(content: string): string {
  return (
    content
      .split(/\n{2,}/)
      .map((block) => block.trim())
      .find((block) => block && !block.startsWith('#') && !block.startsWith('- ')) ?? ''
  );
}

function removeDuplicateTitle(content: string, title: string): string {
  const normalizedTitle = title.trim().toLowerCase();
  const lines = content.split('\n');

  while (lines.length > 0) {
    const line = lines[0].trim();
    if (!line) {
      lines.shift();
      continue;
    }

    const normalizedLine = line
      .replace(/^#+\s*/, '')
      .trim()
      .toLowerCase();
    if (normalizedLine === normalizedTitle) {
      lines.shift();
      continue;
    }

    break;
  }

  return lines.join('\n').trim();
}

function normalizeEntry(
  candidate: ChangelogCandidate,
  requestedVersion?: string
): ChangelogEntry | null {
  const version = normalizeChangelogVersion(
    firstString(candidate.version, requestedVersion, extractVersion(candidate.title))
  );
  if (!version) return null;

  const title = firstString(candidate.title) ?? `What's new in Emdash v${version}`;
  const contentSource =
    firstString(candidate.content, candidate.markdown, candidate.body) ??
    (firstString(candidate.contentHtml, candidate.html)
      ? htmlToMarkdown(firstString(candidate.contentHtml, candidate.html)!)
      : '');

  const dedupedContent = removeDuplicateTitle(contentSource, title);
  const summary =
    firstString(candidate.summary) ??
    extractSummaryFromContent(dedupedContent) ??
    `See what changed in Emdash v${version}.`;

  const content = dedupedContent || summary || `See what changed in Emdash v${version}.`;

  return {
    version,
    title,
    summary,
    content,
    publishedAt: firstString(candidate.publishedAt, candidate.published_at, candidate.date),
    url: firstString(candidate.url, candidate.href),
  };
}

function extractVersion(input: string | null | undefined): string | undefined {
  if (typeof input !== 'string') return undefined;
  const match = input.match(/\bv?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\b/);
  return normalizeChangelogVersion(match?.[1] ?? null) ?? undefined;
}

function pickBestCandidate(
  candidates: ChangelogEntry[],
  requestedVersion?: string
): ChangelogEntry | null {
  if (candidates.length === 0) return null;

  const normalizedRequested = normalizeChangelogVersion(requestedVersion);
  if (normalizedRequested) {
    const exact = candidates.find((candidate) => candidate.version === normalizedRequested);
    if (exact) return exact;
  }

  return candidates
    .slice()
    .sort((left, right) => compareChangelogVersions(right.version, left.version))[0];
}

function extractCandidatesFromPayload(payload: unknown): ChangelogCandidate[] {
  if (!payload || typeof payload !== 'object') return [];

  if (Array.isArray(payload)) {
    return payload.filter((item): item is ChangelogCandidate => !!item && typeof item === 'object');
  }

  const record = payload as Record<string, unknown>;
  const directCandidate = normalizeEntry(record as ChangelogCandidate);
  if (directCandidate) return [record as ChangelogCandidate];

  const collections = ['entry', 'release', 'item', 'entries', 'items', 'releases', 'data'];
  for (const key of collections) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value.filter((item): item is ChangelogCandidate => !!item && typeof item === 'object');
    }
    if (value && typeof value === 'object') {
      return [value as ChangelogCandidate];
    }
  }

  return [];
}

async function fetchJson(url: string): Promise<unknown | null> {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json, text/plain;q=0.9, */*;q=0.8',
      'Cache-Control': 'no-cache',
    },
  });

  if (!response.ok) return null;

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('json')) return null;

  return response.json();
}

function extractTime(block: string): string | undefined {
  const datetime = block.match(/<time\b[^>]*datetime=(["'])(.*?)\1/i)?.[2];
  if (datetime?.trim()) return datetime.trim();

  const timeContent = block.match(/<time\b[^>]*>([\s\S]*?)<\/time>/i)?.[1];
  const normalized = stripTags(timeContent ?? '');
  return normalized || undefined;
}

function extractTitle(block: string): string | undefined {
  const heading = block.match(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i)?.[1];
  const title = stripTags(heading ?? '');
  return title || undefined;
}

function extractSummary(block: string): string | undefined {
  const paragraph = block.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1];
  const summary = stripTags(paragraph ?? '');
  return summary || undefined;
}

export function parseChangelogHtml(html: string, requestedVersion?: string): ChangelogEntry | null {
  const blocks = html.match(/<(article|section)\b[\s\S]*?<\/\1>/gi) ?? [];
  const candidates: ChangelogEntry[] = [];

  for (const block of blocks) {
    const versionFromBlock = normalizeChangelogVersion(
      block.match(/data-version=(["'])(.*?)\1/i)?.[2] ??
        extractVersion(block) ??
        requestedVersion ??
        null
    );
    if (!versionFromBlock) continue;

    const candidate = normalizeEntry(
      {
        version: versionFromBlock,
        title: extractTitle(block),
        summary: extractSummary(block),
        contentHtml: block,
        publishedAt: extractTime(block),
      },
      requestedVersion
    );

    if (candidate) {
      candidates.push(candidate);
    }
  }

  if (candidates.length > 0) {
    return pickBestCandidate(candidates, requestedVersion);
  }

  const fallback = normalizeEntry(
    {
      version: normalizeChangelogVersion(requestedVersion) ?? undefined,
      title: extractTitle(html),
      summary: extractSummary(html),
      contentHtml: html,
      publishedAt: extractTime(html),
    },
    requestedVersion
  );

  return fallback;
}

class ChangelogService {
  async getLatestEntry(requestedVersion?: string): Promise<ChangelogEntry | null> {
    const version = normalizeChangelogVersion(requestedVersion);
    const apiUrls = [
      version
        ? `${EMDASH_CHANGELOG_API_URL}?version=${encodeURIComponent(version)}`
        : `${EMDASH_CHANGELOG_API_URL}?latest=1`,
      version
        ? `${EMDASH_CHANGELOG_URL}.json?version=${encodeURIComponent(version)}`
        : `${EMDASH_CHANGELOG_URL}.json`,
    ];

    for (const url of apiUrls) {
      try {
        const payload = await fetchJson(url);
        if (!payload) continue;

        const entries = extractCandidatesFromPayload(payload)
          .map((candidate) => normalizeEntry(candidate, version ?? undefined))
          .filter((candidate): candidate is ChangelogEntry => candidate !== null);
        const match = pickBestCandidate(entries, version ?? undefined);
        if (match) return match;
      } catch (error) {
        log.debug('Changelog JSON fetch failed', { url, error });
      }
    }

    try {
      const response = await fetch(EMDASH_CHANGELOG_URL, {
        headers: { Accept: 'text/html,application/xhtml+xml', 'Cache-Control': 'no-cache' },
      });
      if (!response.ok) return null;
      const html = await response.text();
      return parseChangelogHtml(html, version ?? undefined);
    } catch (error) {
      log.error('Failed to fetch changelog HTML', error);
      return null;
    }
  }
}

export const changelogService = new ChangelogService();
