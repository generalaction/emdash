/**
 * parse — Markdown string to Block[].
 *
 * Converts raw markdown text into the chat-ui document model (Block[]) using
 * remark/unified. Also provides:
 *   - `flattenBlockHeadings` — normalise heading variants to body for contexts
 *     where large headings are disruptive (e.g. thinking rows).
 *
 * Identity-stable caching of parsed Block arrays lives in the per-instance
 * `ChatCaches.parseBlocks` bundle (core/caches.ts), not here.
 *
 * This module is PURE: no geometry, no pretext/fonts, no DOM imports.
 */

import type {
  BlockContent,
  DefinitionContent,
  Heading,
  Image,
  InlineCode,
  Link,
  ListItem,
  Parent,
  PhrasingContent,
  Root,
  TableCell,
  TableRow,
} from 'mdast';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import type {
  Block,
  BlockId,
  InlineBreak,
  InlineCode as ICode,
  InlineMention,
  InlineRun,
  InlineText,
  ProseBlock,
  ProseVariant,
  RuleBlock,
  TableBlock,
} from './document';
import type { CommandProvider } from './command-provider';
import type { MentionProvider } from './mention-provider';

// ── Shared parser instance ──────────────────────────────────────────────────

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);

// ── Inline phrasing → InlineRun[] ──────────────────────────────────────────

// ── @-mention scanning ──────────────────────────────────────────────────────

/**
 * Regex matching quoted file mentions: @"<path>". The path may contain spaces
 * and any character except a literal double-quote or newline. Matched before
 * AT_TOKEN_RE so that paths with special characters round-trip intact.
 *
 * Example matched: @"/Users/me/My Project/foo.ts"
 */
const QUOTED_AT_TOKEN_RE = /@"([^"\n]+)"/g;

/**
 * Regex matching `@<token>` where token runs to the next whitespace, @, or end
 * of string. Tokens may include word chars, dots, slashes, hyphens, colons,
 * and parens (covering file paths, issue refs, and symbol names).
 *
 * Dots are consumed only when followed by another token char, so a trailing
 * sentence-final dot is not absorbed: `@hello.ts.` captures `hello.ts`.
 * Internal dots (`src/auth/jwt.ts`) and leading/dotfile dots (`.gitignore`)
 * are preserved.
 *
 * Examples matched: @src/auth/jwt.ts  @issue-42  @handleSubmit()  @.gitignore
 */
const AT_TOKEN_RE = /@((?:[\w/\-:()]|\.(?=[\w/\-:()]))+)/g;

/**
 * Regex matching `/<token>` at the start of the string or after whitespace.
 * Token is one or more word chars or hyphens (command names only — no paths).
 *
 * Examples matched: /web  /search-files  /explain
 * Non-matches: path/to/file  https://example.com/path
 */
const SLASH_TOKEN_RE = /(?:^|(?<=\s))\/([\w-]+)/g;

/**
 * Split a plain-text segment on @-mentions and /commands, using the
 * respective providers to validate each token, and return a mixed
 * InlineText / InlineMention run array.
 * When no providers are supplied, the segment is returned as a single InlineText.
 */
function splitAtMentions(
  text: string,
  opts: { bold?: boolean; italic?: boolean; strike?: boolean; href?: string },
  mentionProvider: MentionProvider | undefined,
  commandProvider: CommandProvider | undefined,
  uri: string | undefined
): InlineRun[] {
  const hasAtTokens = mentionProvider && text.includes('@');
  const hasSlashTokens = commandProvider && text.includes('/');

  if (!hasAtTokens && !hasSlashTokens) {
    return text.length > 0
      ? [
          {
            kind: 'text',
            text,
            bold: opts.bold,
            italic: opts.italic,
            strike: opts.strike,
            href: opts.href,
          } satisfies InlineText,
        ]
      : [];
  }

  // Collect all token matches (@ and /) with their resolved run, then sort by
  // position so we can walk the string in order.
  type TokenHit = { index: number; length: number; run: InlineRun };
  const hits: TokenHit[] = [];

  // Quoted file mentions are tried first so paths with spaces/special chars
  // round-trip intact. Each matched range is recorded and the bare matcher
  // skips any position that falls inside a quoted range.
  const quotedRanges: Array<[number, number]> = [];

  if (mentionProvider) {
    QUOTED_AT_TOKEN_RE.lastIndex = 0;
    let qm: RegExpExecArray | null;
    while ((qm = QUOTED_AT_TOKEN_RE.exec(text)) !== null) {
      const token = qm[1];
      const meta = mentionProvider.resolve(token, uri);
      if (!meta) continue;
      const rangeEnd = qm.index + qm[0].length;
      quotedRanges.push([qm.index, rangeEnd]);
      hits.push({
        index: qm.index,
        length: qm[0].length,
        run: {
          kind: 'mention',
          label: meta.label,
          id: meta.id,
          name: meta.name,
          mentionKind: meta.kind,
          iconClass: meta.iconClass,
        } satisfies InlineMention,
      });
    }
  }

  if (mentionProvider) {
    AT_TOKEN_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = AT_TOKEN_RE.exec(text)) !== null) {
      // Skip positions that are inside an already-matched quoted range.
      if (quotedRanges.some(([s, e]) => match!.index >= s && match!.index < e)) continue;
      const token = match[1];
      const meta = mentionProvider.resolve(token, uri);
      if (!meta) continue;
      hits.push({
        index: match.index,
        length: match[0].length,
        run: {
          kind: 'mention',
          label: meta.label,
          id: meta.id,
          name: meta.name,
          mentionKind: meta.kind,
          iconClass: meta.iconClass,
        } satisfies InlineMention,
      });
    }
  }

  if (commandProvider) {
    SLASH_TOKEN_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = SLASH_TOKEN_RE.exec(text)) !== null) {
      const token = match[1];
      const meta = commandProvider.resolve(token, uri);
      if (!meta) continue;
      // The full match may start with a leading whitespace character captured
      // by the lookbehind alternative; skip it so the slice is tight.
      const prefixLen = match[0].length - token.length - 1; // chars before "/"
      hits.push({
        index: match.index + prefixLen,
        length: 1 + token.length, // "/<token>"
        run: {
          kind: 'mention',
          label: `/${meta.name}`,
          tone: 'command',
        } satisfies InlineMention,
      });
    }
  }

  if (hits.length === 0) {
    return text.length > 0
      ? [
          {
            kind: 'text',
            text,
            bold: opts.bold,
            italic: opts.italic,
            strike: opts.strike,
            href: opts.href,
          } satisfies InlineText,
        ]
      : [];
  }

  // Sort by start position (they should not overlap, but sort for safety).
  hits.sort((a, b) => a.index - b.index);

  const runs: InlineRun[] = [];
  let lastIndex = 0;

  for (const hit of hits) {
    // Emit preceding plain text
    if (hit.index > lastIndex) {
      runs.push({
        kind: 'text',
        text: text.slice(lastIndex, hit.index),
        bold: opts.bold,
        italic: opts.italic,
        strike: opts.strike,
        href: opts.href,
      } satisfies InlineText);
    }

    runs.push(hit.run);
    lastIndex = hit.index + hit.length;
  }

  // Trailing plain text
  if (lastIndex < text.length) {
    runs.push({
      kind: 'text',
      text: text.slice(lastIndex),
      bold: opts.bold,
      italic: opts.italic,
      strike: opts.strike,
      href: opts.href,
    } satisfies InlineText);
  }

  return runs;
}

function phrasingsToRuns(
  nodes: PhrasingContent[],
  opts: { bold?: boolean; italic?: boolean; strike?: boolean; href?: string } = {},
  mentionProvider?: MentionProvider,
  commandProvider?: CommandProvider,
  uri?: string
): InlineRun[] {
  const runs: InlineRun[] = [];

  for (const node of nodes) {
    switch (node.type) {
      case 'text': {
        // Split on literal newlines (soft breaks inside a paragraph) and emit
        // an InlineBreak between each segment so layoutProse can force a new line.
        const segments = node.value.split('\n');
        for (let i = 0; i < segments.length; i++) {
          if (i > 0) runs.push({ kind: 'break' } satisfies InlineBreak);
          const seg = segments[i];
          runs.push(...splitAtMentions(seg, opts, mentionProvider, commandProvider, uri));
        }
        break;
      }

      case 'inlineCode': {
        runs.push({ kind: 'code', text: (node as InlineCode).value } satisfies ICode);
        break;
      }

      case 'strong': {
        runs.push(
          ...phrasingsToRuns(
            (node as Parent).children as PhrasingContent[],
            {
              ...opts,
              bold: true,
            },
            mentionProvider,
            commandProvider,
            uri
          )
        );
        break;
      }

      case 'emphasis': {
        runs.push(
          ...phrasingsToRuns(
            (node as Parent).children as PhrasingContent[],
            {
              ...opts,
              italic: true,
            },
            mentionProvider,
            commandProvider,
            uri
          )
        );
        break;
      }

      case 'delete': {
        runs.push(
          ...phrasingsToRuns(
            (node as Parent).children as PhrasingContent[],
            {
              ...opts,
              strike: true,
            },
            mentionProvider,
            commandProvider,
            uri
          )
        );
        break;
      }

      // Hard break (two trailing spaces or backslash before newline in markdown).
      case 'break': {
        runs.push({ kind: 'break' } satisfies InlineBreak);
        break;
      }

      case 'link': {
        const link = node as Link;
        runs.push(
          ...phrasingsToRuns(
            link.children as PhrasingContent[],
            { ...opts, href: link.url },
            mentionProvider,
            commandProvider,
            uri
          )
        );
        break;
      }

      case 'image': {
        // Images inside prose are treated as inline text (alt text); the slot path
        // for block-level images is handled in blockToBlocks via the 'image' mdast type.
        const img = node as Image;
        runs.push({ kind: 'text', text: img.alt || '[image]', href: img.url } satisfies InlineText);
        break;
      }

      // mdast extension — math inline (remark-math attaches 'inlineMath' type)
      case 'inlineMath': {
        const run: InlineMention = { kind: 'mention', label: '∑ math', tone: 'math' };
        runs.push(run);
        break;
      }

      default:
        // Ignore unknown inline node types (html, footnote references, …)
        break;
    }
  }

  return runs;
}

// ── mdast node → Block[] ────────────────────────────────────────────────────

function blockToBlocks(
  node: BlockContent | DefinitionContent,
  messageId: string,
  counter: { n: number },
  depth = 0,
  mentionProvider?: MentionProvider,
  inQuote = false,
  uri?: string,
  commandProvider?: CommandProvider
): Block[] {
  const nextId = (): BlockId => `${messageId}#${counter.n++}`;
  const blocks: Block[] = [];

  switch (node.type) {
    case 'paragraph': {
      const parent = node as Parent;
      const runs = phrasingsToRuns(
        parent.children as PhrasingContent[],
        {},
        mentionProvider,
        commandProvider,
        uri
      );
      if (runs.length > 0) {
        blocks.push({
          kind: 'prose',
          id: nextId(),
          variant: inQuote ? 'quote' : 'body',
          runs,
          depth,
        } satisfies ProseBlock);
      }
      break;
    }

    case 'heading': {
      const h = node as Heading;
      const variant = `h${h.depth}` as ProseVariant;
      const runs = phrasingsToRuns(
        h.children as PhrasingContent[],
        {},
        mentionProvider,
        commandProvider,
        uri
      );
      if (runs.length > 0) {
        blocks.push({
          kind: 'prose',
          id: nextId(),
          variant,
          runs,
        } satisfies ProseBlock);
      }
      break;
    }

    case 'blockquote': {
      for (const child of (node as Parent).children) {
        blocks.push(
          ...blockToBlocks(
            child as BlockContent,
            messageId,
            counter,
            depth + 1,
            mentionProvider,
            true,
            uri,
            commandProvider
          )
        );
      }
      break;
    }

    case 'list': {
      const list = node as Parent;
      for (const child of list.children) {
        const item = child as ListItem;
        // A list item may contain nested paragraphs and sub-lists.
        for (const itemChild of (item as Parent).children) {
          if (itemChild.type === 'paragraph') {
            const runs = phrasingsToRuns(
              (itemChild as Parent).children as PhrasingContent[],
              {},
              mentionProvider,
              commandProvider,
              uri
            );
            if (runs.length > 0) {
              blocks.push({
                kind: 'prose',
                id: nextId(),
                variant: 'list-item',
                runs,
                depth,
              } satisfies ProseBlock);
            }
          } else {
            blocks.push(
              ...blockToBlocks(
                itemChild as BlockContent,
                messageId,
                counter,
                depth + 1,
                mentionProvider,
                false,
                uri,
                commandProvider
              )
            );
          }
        }
      }
      break;
    }

    case 'code': {
      const codeLang = node.lang?.toLowerCase();
      if (codeLang === 'mermaid' || codeLang === 'mmd') {
        blocks.push({
          kind: 'mermaid',
          id: nextId(),
          source: node.value,
        });
      } else {
        blocks.push({
          kind: 'code',
          id: nextId(),
          code: node.value,
          lang: node.lang ?? undefined,
        });
      }
      break;
    }

    case 'table': {
      const tableNode = node as Parent;
      const allRows = tableNode.children.map((row) =>
        (row as TableRow).children.map((cell) => {
          const cellNode = cell as TableCell & Parent;
          // Table cell text is plain: @mentions and /commands become their label text
          return phrasingsToRuns(
            cellNode.children as PhrasingContent[],
            {},
            mentionProvider,
            commandProvider,
            uri
          )
            .map((r) => ('text' in r ? r.text : 'label' in r ? r.label : ''))
            .join('');
        })
      );
      const [header = [], ...rows] = allRows;
      blocks.push({
        kind: 'table',
        id: nextId(),
        header,
        rows,
      } satisfies TableBlock);
      break;
    }

    case 'thematicBreak': {
      blocks.push({
        kind: 'rule',
        id: nextId(),
      } satisfies RuleBlock);
      break;
    }

    // remark-math adds 'math' (block-level) — rendered as plain text for now.
    case 'math': {
      blocks.push({
        kind: 'prose',
        id: nextId(),
        variant: 'body',
        runs: [{ kind: 'text', text: node.value }],
      } satisfies ProseBlock);
      break;
    }

    default:
      // Unknown block types — skip
      break;
  }

  return blocks;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Parse a markdown string into a stable `Block[]` that both the measurement
 * engine and block renderer components consume.
 *
 * Block IDs are in the form `${messageId}#${index}` where `index` is the
 * position in the flat block list produced by the parse. IDs are stable as
 * long as the full text is re-parsed (not incrementally mutated). A streaming
 * message is kept as a single prose unit until `finalizeTurn()` freezes the
 * text and re-parses with the complete content.
 *
 * @param messageId       - Stable item id used as the block-id prefix.
 * @param markdown        - Raw markdown string to parse.
 * @param mentionProvider - Optional @-mention resolver; when supplied, `@token` spans
 *                          that resolve to metadata are emitted as InlineMention runs.
 * @param commandProvider - Optional /-command resolver; when supplied, `/token` spans
 *                          that resolve to metadata are emitted as InlineMention runs
 *                          with `tone: 'command'`.
 * @param startN          - Starting block counter (default 0). Used by the incremental
 *                          streaming parser to assign continuation IDs when parsing tail
 *                          chunks so they join seamlessly with the stable prefix IDs.
 * @param uri             - Conversation URI forwarded to provider `.resolve()` so
 *                          a global provider can scope resolution to the right context.
 */
export function parseMarkdownToBlocks(
  messageId: string,
  markdown: string,
  mentionProvider?: MentionProvider,
  commandProvider?: CommandProvider,
  startN = 0,
  uri?: string
): Block[] {
  if (!markdown.trim()) return [];

  const tree = parser.parse(markdown) as Root;
  const counter = { n: startN };
  const blocks: Block[] = [];

  for (const child of tree.children) {
    blocks.push(
      ...blockToBlocks(
        child as BlockContent | DefinitionContent,
        messageId,
        counter,
        0,
        mentionProvider,
        false,
        uri,
        commandProvider
      )
    );
  }

  return blocks;
}

// ── Block normalization helpers ───────────────────────────────────────────────

/**
 * Demote every heading variant (h1–h6) to `'body'` so the text measures and
 * renders at body size/weight. Inline runs (bold, code, links, mentions) are
 * preserved untouched.
 *
 * Use when large headings are not appropriate for the rendering context (e.g.
 * the reasoning / thinking row where AI-generated section headers would be
 * visually disruptive).
 *
 * @param blocks - Block array to transform (not mutated; returns a new array).
 */
export function flattenBlockHeadings(blocks: Block[]): Block[] {
  return blocks.map((b) =>
    b.kind === 'prose' && b.variant !== 'body' && b.variant !== 'list-item' && b.variant !== 'quote'
      ? { ...b, variant: 'body' as const }
      : b
  );
}
