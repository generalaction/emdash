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
  TableBlock,
} from './block-types';

// ── Shared parser instance ──────────────────────────────────────────────────

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);

// ── Inline phrasing → InlineRun[] ──────────────────────────────────────────

function phrasingsToRuns(
  nodes: PhrasingContent[],
  opts: { bold?: boolean; italic?: boolean; strike?: boolean; href?: string } = {}
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
          if (seg.length > 0) {
            runs.push({
              kind: 'text',
              text: seg,
              bold: opts.bold,
              italic: opts.italic,
              strike: opts.strike,
              href: opts.href,
            } satisfies InlineText);
          }
        }
        break;
      }

      case 'inlineCode': {
        runs.push({ kind: 'code', text: (node as InlineCode).value } satisfies ICode);
        break;
      }

      case 'strong': {
        runs.push(
          ...phrasingsToRuns((node as Parent).children as PhrasingContent[], {
            ...opts,
            bold: true,
          })
        );
        break;
      }

      case 'emphasis': {
        runs.push(
          ...phrasingsToRuns((node as Parent).children as PhrasingContent[], {
            ...opts,
            italic: true,
          })
        );
        break;
      }

      case 'delete': {
        runs.push(
          ...phrasingsToRuns((node as Parent).children as PhrasingContent[], {
            ...opts,
            strike: true,
          })
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
          ...phrasingsToRuns(link.children as PhrasingContent[], { ...opts, href: link.url })
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
  depth = 0
): Block[] {
  const nextId = (): BlockId => `${messageId}#${counter.n++}`;
  const blocks: Block[] = [];

  switch (node.type) {
    case 'paragraph': {
      const parent = node as Parent;
      const runs = phrasingsToRuns(parent.children as PhrasingContent[]);
      if (runs.length > 0) {
        blocks.push({
          kind: 'prose',
          tier: 'prose',
          id: nextId(),
          variant: 'body',
          runs,
          depth,
        } satisfies ProseBlock);
      }
      break;
    }

    case 'heading': {
      const h = node as Heading;
      const variant = `h${h.depth}` as ProseVariant;
      const runs = phrasingsToRuns(h.children as PhrasingContent[]);
      if (runs.length > 0) {
        blocks.push({
          kind: 'prose',
          tier: 'prose',
          id: nextId(),
          variant,
          runs,
        } satisfies ProseBlock);
      }
      break;
    }

    case 'blockquote': {
      for (const child of (node as Parent).children) {
        blocks.push(...blockToBlocks(child as BlockContent, messageId, counter, depth + 1));
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
            const runs = phrasingsToRuns((itemChild as Parent).children as PhrasingContent[]);
            if (runs.length > 0) {
              blocks.push({
                kind: 'prose',
                tier: 'prose',
                id: nextId(),
                variant: 'list-item',
                runs,
                depth,
              } satisfies ProseBlock);
            }
          } else {
            blocks.push(...blockToBlocks(itemChild as BlockContent, messageId, counter, depth + 1));
          }
        }
      }
      break;
    }

    case 'code': {
      blocks.push({
        kind: 'code',
        tier: 'code',
        id: nextId(),
        code: node.value,
        lang: node.lang ?? undefined,
      });
      break;
    }

    case 'table': {
      const tableNode = node as Parent;
      const allRows = tableNode.children.map((row) =>
        (row as TableRow).children.map((cell) => {
          const cellNode = cell as TableCell & Parent;
          return phrasingsToRuns(cellNode.children as PhrasingContent[])
            .map((r) => ('text' in r ? r.text : 'label' in r ? r.label : ''))
            .join('');
        })
      );
      const [header = [], ...rows] = allRows;
      blocks.push({
        kind: 'table',
        tier: 'table',
        id: nextId(),
        header,
        rows,
      } satisfies TableBlock);
      break;
    }

    case 'thematicBreak': {
      // Horizontal rules are rendered as a prose separator line.
      blocks.push({
        kind: 'prose',
        tier: 'prose',
        id: nextId(),
        variant: 'body',
        runs: [{ kind: 'text', text: '—' }],
      } satisfies ProseBlock);
      break;
    }

    // remark-math adds 'math' (block-level) — rendered as plain text for now.
    case 'math': {
      blocks.push({
        kind: 'prose',
        tier: 'prose',
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
 * @param messageId - Stable item id used as the block-id prefix.
 * @param markdown  - Raw markdown string to parse.
 */
export function parseMarkdownToBlocks(messageId: string, markdown: string): Block[] {
  if (!markdown.trim()) return [];

  const tree = parser.parse(markdown) as Root;
  const counter = { n: 0 };
  const blocks: Block[] = [];

  for (const child of tree.children) {
    blocks.push(...blockToBlocks(child as BlockContent | DefinitionContent, messageId, counter));
  }

  return blocks;
}

// ── Cached entry point ───────────────────────────────────────────────────────

type CacheEntry = { text: string; blocks: Block[] };

const blockCache = new Map<string, CacheEntry>();

/**
 * Parse a markdown string into a stable `Block[]`, with a module-level LRU
 * cache keyed by `messageId`.
 *
 * **Cache semantics**
 * - Committed (non-streaming) messages: text is immutable, so the cache gives
 *   parse-once-per-message semantics across all re-renders and layout passes.
 * - Streaming messages: the text grows each chunk; the text-equality check
 *   ensures a re-parse only when content actually changes.
 * - **Identity guarantee**: consecutive calls with the same `messageId` and
 *   identical `markdown` return the *exact same array reference*, so downstream
 *   identity checks (`===`) can detect "no change".
 * - **Invalidation**: call `clearBlockCache()` when a conversation is torn
 *   down, or `evictBlockCache(id)` to evict a single message (e.g. after
 *   `finalizeTurn` freezes the text and you want a clean re-parse).
 *
 * @param messageId - Stable item id; used as the cache key and block-id prefix.
 * @param markdown  - Raw markdown string to parse.
 */
export function parseMarkdownToBlocksCached(messageId: string, markdown: string): Block[] {
  const hit = blockCache.get(messageId);
  if (hit && hit.text === markdown) return hit.blocks;
  const blocks = parseMarkdownToBlocks(messageId, markdown);
  blockCache.set(messageId, { text: markdown, blocks });
  return blocks;
}

/**
 * @deprecated Use `parseMarkdownToBlocksCached` instead.
 * @internal kept temporarily for any call sites not yet migrated.
 */
export const parseBlocksCached = parseMarkdownToBlocksCached;

/** Evict all cached block arrays (call when a conversation store is reset). */
export function clearBlockCache(): void {
  blockCache.clear();
}

/** Evict the cached blocks for a single message (call after finalizeTurn per message). */
export function evictBlockCache(messageId: string): void {
  blockCache.delete(messageId);
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
    b.tier === 'prose' && b.variant !== 'body' && b.variant !== 'list-item' && b.variant !== 'quote'
      ? { ...b, variant: 'body' as const }
      : b
  );
}

/**
 * @deprecated Use `flattenBlockHeadings` instead.
 * @internal kept temporarily for any call sites not yet migrated.
 */
export const flattenHeadings = flattenBlockHeadings;

// ── Shared thinking pipeline ──────────────────────────────────────────────────

/**
 * Parse and transform a thinking item's markdown into the `Block[]` used by
 * both the measurement engine and `ThinkingProse`.
 *
 * Applies:
 *   1. `parseMarkdownToBlocksCached` — parse with identity-stable caching.
 *   2. `flattenBlockHeadings` — demote headings to body variant so AI-generated
 *      section headers don't produce oversized lines in the thinking row.
 *
 * @param id   - Stable thinking item id; used as the cache key.
 * @param text - Raw markdown string (may be `undefined` during streaming).
 */
export function buildThinkingBlocks(id: string, text: string | undefined): Block[] {
  return flattenBlockHeadings(parseMarkdownToBlocksCached(id, text ?? ''));
}

