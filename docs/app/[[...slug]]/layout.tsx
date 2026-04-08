import { source } from '@/lib/source';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import type { ReactNode } from 'react';
import type { Node } from 'fumadocs-core/page-tree';
import { baseOptions } from '@/lib/layout.shared';

const betaPages = new Set(['/automations']);

function addBetaBadges(nodes: Node[]): Node[] {
  return nodes.map((node) => {
    if (node.type === 'page' && betaPages.has(node.url)) {
      return {
        ...node,
        name: (
          <>
            {node.name}
            <span className="bg-fd-secondary text-fd-muted-foreground ml-1.5 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase leading-none tracking-wide">
              Beta
            </span>
          </>
        ),
      };
    }
    if (node.type === 'folder' && node.children) {
      return { ...node, children: addBetaBadges(node.children) };
    }
    return node;
  });
}

export default function Layout({ children }: { children: ReactNode }) {
  const tree = {
    ...source.pageTree,
    children: addBetaBadges(source.pageTree.children),
  };

  return (
    <DocsLayout tree={tree} {...baseOptions()}>
      {children}
    </DocsLayout>
  );
}
