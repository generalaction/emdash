import type { IssueData } from '../../types';
import { normalizePath } from './glob';

/**
 * Maps one markdown task file to the canonical issue shape. Every input (the
 * file's repository-relative path, its text, the repository root and the
 * last-changed timestamp) is supplied by the reader, so the mapping stays
 * testable without a filesystem or a git process.
 */

/**
 * Lifecycle vocabularies differ per repository, so the mapping is a table and
 * anything unrecognized passes through verbatim rather than being forced into
 * a status the file never claimed.
 */
const STATUS_MAP: Record<string, string> = {
  ready: 'todo',
  todo: 'todo',
  backlog: 'backlog',
  in_progress: 'in_progress',
  'in-progress': 'in_progress',
  active: 'in_progress',
  in_review: 'review',
  'in-review': 'review',
  review: 'review',
  // emdash has no blocked lifecycle status; `triage` is the nearest one, and
  // it means what blocked means here: a human has to look before it moves.
  blocked: 'triage',
  done: 'done',
  complete: 'done',
  completed: 'done',
  cancelled: 'cancelled',
  canceled: 'cancelled',
};

export const HOLDOUT_LABEL = 'holdout';

export type BriefFile = {
  /** Repository-relative, `/`-separated. */
  path: string;
  /** Absolute path of the repository working tree, for the `file://` url. */
  repositoryPath: string;
  text: string;
  /** ISO-8601: the file's last commit date, or its mtime in a working-tree read. */
  updatedAt?: string;
};

export type BriefIdentity = {
  /** `WO-1811`: the `<PREFIX>-<number>` token the file name starts with. */
  id: string;
  /** `the-backend-context-retries-after-an-outage`: the rest of the file name. */
  slug: string;
};

/** `WO-1811-the-backend-context.md` yields id `WO-1811`, slug `the-backend-context`. */
export function parseBriefIdentity(relativePath: string): BriefIdentity {
  const fileName = normalizePath(relativePath).split('/').at(-1) ?? relativePath;
  const stem = fileName.replace(/\.[^.]+$/u, '');
  const match = /^([A-Za-z]+-\d+)(?:-(.*))?$/u.exec(stem);
  if (!match) return { id: stem, slug: stem };
  return { id: match[1]!, slug: match[2] ?? '' };
}

/**
 * The capability a task file belongs to, read off the path segments the
 * pattern's directory wildcards matched: `docs/capabilities/<*>/<*>/tasks/WO-*.md`
 * over `docs/capabilities/platform/connectors/tasks/WO-1811-x.md` yields
 * `platform/connectors`. Patterns containing `**` have no positional
 * alignment, so they carry no capability.
 */
export function deriveCapability(pattern: string, relativePath: string): string | undefined {
  const patternSegments = normalizePath(pattern).split('/');
  if (patternSegments.includes('**')) return undefined;
  const pathSegments = normalizePath(relativePath).split('/');
  if (pathSegments.length !== patternSegments.length) return undefined;

  const captured: string[] = [];
  // The last segment is the file name; only directory wildcards name a capability.
  for (let index = 0; index < patternSegments.length - 1; index += 1) {
    if (!/[*?]/u.test(patternSegments[index]!)) continue;
    captured.push(pathSegments[index]!);
  }
  return captured.length ? captured.join('/') : undefined;
}

export type Frontmatter = {
  fields: Record<string, string>;
  /** The document with its frontmatter block removed. */
  body: string;
};

/**
 * The scalar half of YAML frontmatter: `key: value` lines between `---`
 * fences. Nested structures are skipped rather than parsed, because a task
 * file's lifecycle fields are all scalars and a YAML dependency for the rest
 * would buy nothing.
 */
export function parseFrontmatter(text: string): Frontmatter {
  const normalized = text.replace(/^\uFEFF/u, '');
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/u.exec(normalized);
  if (!match) return { fields: {}, body: normalized };

  const fields: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/u)) {
    const field = /^([A-Za-z0-9_-]+):[ \t]*(.*)$/u.exec(line);
    if (!field) continue;
    fields[field[1]!.toLowerCase()] = stripQuotes(field[2]!.trim());
  }
  return { fields, body: normalized.slice(match[0].length) };
}

/** The first H1, with a leading id token (`WO-1811:`) removed. */
export function parseTitle(body: string, id: string): string | undefined {
  const heading = /^[ \t]{0,3}#[ \t]+(.+?)[ \t]*#*[ \t]*$/mu.exec(body);
  if (!heading) return undefined;
  const escapedId = id.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return heading[1]!.replace(new RegExp(`^${escapedId}[ \\t]*[:.-]?[ \\t]*`, 'iu'), '').trim();
}

/**
 * Whether the file declares itself a holdout: a `holdout: true` frontmatter
 * field, or a truthy cell under a `holdout` column of any markdown table. The
 * column lookup is what keeps the word "holdout" in prose from counting.
 */
export function hasHoldout(frontmatter: Frontmatter): boolean {
  if (isTruthy(frontmatter.fields.holdout)) return true;
  return tableColumnHasTruthyCell(frontmatter.body, HOLDOUT_LABEL);
}

export function mapStatus(raw: string | undefined): string | undefined {
  const value = raw?.trim().toLowerCase();
  if (!value) return undefined;
  return STATUS_MAP[value] ?? value;
}

export function toIssueData(file: BriefFile, pattern: string): IssueData {
  const relativePath = normalizePath(file.path);
  const { id, slug } = parseBriefIdentity(relativePath);
  const frontmatter = parseFrontmatter(file.text);
  const capability = deriveCapability(pattern, relativePath);
  const status = mapStatus(frontmatter.fields.status);
  const branchName = branchNameFor(id, slug);
  const labels = [
    ...(capability ? [capability] : []),
    ...(hasHoldout(frontmatter) ? [HOLDOUT_LABEL] : []),
  ];

  return {
    identifier: id,
    title: parseTitle(frontmatter.body, id) || slug || id,
    url: toFileUrl(`${trimTrailingSlash(file.repositoryPath)}/${relativePath}`),
    description: frontmatter.body.trim() || undefined,
    ...(branchName !== undefined && { branchName }),
    ...(status !== undefined && { status }),
    ...(labels.length > 0 && { labels }),
    ...(capability !== undefined && { project: capability }),
    ...(file.updatedAt !== undefined && { updatedAt: file.updatedAt }),
  };
}

/**
 * The branch a task file names: `feature/<lowercased id>-<slug>`. A provider
 * suggestion only, exactly like every other provider that reports one; the
 * host still owns what a task's branch becomes.
 */
function branchNameFor(id: string, slug: string): string | undefined {
  if (!slug) return undefined;
  return `feature/${id.toLowerCase()}-${slug}`;
}

function tableColumnHasTruthyCell(body: string, columnName: string): boolean {
  let columnIndex = -1;
  for (const line of body.split(/\r?\n/u)) {
    if (!line.includes('|')) {
      columnIndex = -1;
      continue;
    }
    const cells = splitRow(line);
    if (columnIndex === -1) {
      const header = cells.findIndex((cell) => cell.toLowerCase() === columnName);
      if (header !== -1) columnIndex = header;
      continue;
    }
    if (isSeparatorRow(cells)) continue;
    if (isTruthy(cells[columnIndex])) return true;
  }
  return false;
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/u, '')
    .replace(/\|$/u, '')
    .split('|')
    .map((cell) => cell.trim());
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-{1,}:?$/u.test(cell));
}

function isTruthy(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === 'true' || normalized === 'yes';
}

function stripQuotes(value: string): string {
  const match = /^(['"])(.*)\1$/u.exec(value);
  return match ? match[2]! : value;
}

/**
 * A `file://` url for an absolute path, without pulling `node:url` into the
 * module graph: the issues entry is typechecked by the renderer program too,
 * so nothing reachable from it may import a node builtin.
 */
function toFileUrl(absolutePath: string): string {
  const normalized = absolutePath.replace(/\\/gu, '/');
  const rooted = normalized.startsWith('/') ? normalized : `/${normalized}`;
  return `file://${rooted.split('/').map(encodeSegment).join('/')}`;
}

function encodeSegment(segment: string): string {
  // A drive letter's colon is legal in a file url and reads better unescaped.
  return encodeURIComponent(segment).replace(/%3A/giu, ':');
}

function trimTrailingSlash(value: string): string {
  return value.replace(/[/\\]+$/u, '');
}
