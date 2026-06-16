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
  InlineCode as ICode,
  InlineMention,
  InlineRun,
  InlineText,
  IslandBlock,
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
        runs.push({
          kind: 'text',
          text: node.value,
          bold: opts.bold,
          italic: opts.italic,
          strike: opts.strike,
          href: opts.href,
        } satisfies InlineText);
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
      // A paragraph that contains only an image becomes an island.
      if (parent.children.length === 1 && parent.children[0].type === 'image') {
        const img = parent.children[0] as Image;
        blocks.push({
          kind: 'island',
          tier: 'island',
          id: nextId(),
          islandType: 'image',
          raw: img.url,
        } satisfies IslandBlock);
      } else {
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
      blocks.push({
        kind: 'island',
        tier: 'island',
        id: nextId(),
        islandType: 'rule',
        raw: '-',
      } satisfies IslandBlock);
      break;
    }

    // remark-math adds 'math' (block-level)
    case 'math': {
      blocks.push({
        kind: 'island',
        tier: 'island',
        id: nextId(),
        islandType: 'math',
        raw: node.value,
      } satisfies IslandBlock);
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
 * Parse a markdown string into a stable `Block[]` that both `HeightModel`
 * (measurement) and the block renderer components consume.
 *
 * Block IDs are in the form `${messageId}#${index}` where `index` is the
 * position in the flat block list produced by the parse. IDs are stable as
 * long as the full text is re-parsed (not incrementally mutated). A streaming
 * message is kept as a single prose unit until `finalizeTurn()` freezes the
 * text and re-parses with the complete content.
 */
export function parseBlocks(messageId: string, markdown: string): Block[] {
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

/**
 * Module-level parse cache keyed by `messageId`.
 *
 * For committed (non-streaming) messages the text never changes, so this gives
 * parse-once-per-message semantics. For streaming messages the text grows each
 * chunk, so the text-equality check ensures a re-parse happens only when content
 * actually changes. Call `clearBlockCache()` when a conversation is torn down.
 */
const blockCache = new Map<string, CacheEntry>();

export function parseBlocksCached(messageId: string, markdown: string): Block[] {
  const hit = blockCache.get(messageId);
  if (hit && hit.text === markdown) return hit.blocks;
  const blocks = parseBlocks(messageId, markdown);
  blockCache.set(messageId, { text: markdown, blocks });
  return blocks;
}

/** Evict all cached block arrays (call when a conversation store is reset). */
export function clearBlockCache(): void {
  blockCache.clear();
}

/** Evict the cached blocks for a single message (call after finalizeTurn per message). */
export function evictBlockCache(messageId: string): void {
  blockCache.delete(messageId);
}
