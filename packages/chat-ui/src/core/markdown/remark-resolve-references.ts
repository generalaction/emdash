import type { Definition, ImageReference, LinkReference, Root } from 'mdast';
import { visit } from 'unist-util-visit';

/**
 * Resolve reference-style links and images into their inline equivalents.
 *
 * `[text][id]` parses to a `linkReference` node and `![alt][id]` to an
 * `imageReference` node, neither of which the block/inline walk in `parse.ts`
 * handles — so without this transform they (and their visible text) are dropped
 * entirely. This plugin rewrites each reference to the `link` / `image` node the
 * walk already renders, using the document's `definition` nodes for the URL.
 *
 * remark-parse only emits `linkReference` / `imageReference` when a matching
 * definition exists — an undefined reference such as `[text][missing]` is
 * already plain text — so every reference reached here has a definition.
 * Matching is case-insensitive on the identifier, per CommonMark.
 */
export function remarkResolveReferences() {
  return (tree: Root): void => {
    const definitions = new Map<string, Definition>();
    visit(tree, 'definition', (node) => {
      definitions.set(node.identifier.toLowerCase(), node);
    });
    if (definitions.size === 0) return;

    visit(tree, 'linkReference', (node: LinkReference) => {
      const def = definitions.get(node.identifier.toLowerCase());
      if (!def) return;
      const link = node as unknown as { type: string; url: string; title: string | null };
      link.type = 'link';
      link.url = def.url;
      link.title = def.title ?? null;
    });

    visit(tree, 'imageReference', (node: ImageReference) => {
      const def = definitions.get(node.identifier.toLowerCase());
      if (!def) return;
      // `alt` already lives on the imageReference node and is what the `image`
      // renderer reads, so only the node type, url, and title need to change.
      const image = node as unknown as { type: string; url: string; title: string | null };
      image.type = 'image';
      image.url = def.url;
      image.title = def.title ?? null;
    });
  };
}
