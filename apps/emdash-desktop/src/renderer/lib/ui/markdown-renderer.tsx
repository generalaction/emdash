import React, { useEffect, useMemo, useState } from 'react';
import Markdown from 'react-markdown';
import type { ExtraProps } from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import type { PluggableList } from 'unified';
import { useTheme } from '@renderer/lib/hooks/useTheme';
import { confirmOpenExternalLink } from '@renderer/lib/open-external-link';
import { cn } from '@renderer/utils/utils';
import { ExpandableImage } from './expandable-image';
import { normalizeLatexDelimiters } from './markdown-latex';
import { MermaidDiagram } from './mermaid-diagram';

type Variant = 'full' | 'compact';

interface MarkdownRendererProps {
  content: string;
  variant?: Variant;
  className?: string;
  allowHtml?: boolean;
  /**
   * Optional callback for resolving non-external image src values (e.g. relative
   * paths inside a workspace). Should return a `data:` URI string, or `null` to
   * render a "not found" placeholder. When omitted, local images are not resolved.
   */
  resolveImage?: (src: string) => Promise<string | null>;
}

// Sanitize runs before rehype-katex so user input is sanitized but KaTeX's
// (trusted) output passes through untouched. The schema preserves the
// math-inline/math-display classes that remark-math emits so rehype-katex can
// still recognize them post-sanitize.
const sanitizeSchema = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    src: [...(defaultSchema.protocols?.src || []), 'data'],
  },
  attributes: {
    ...defaultSchema.attributes,
    span: [
      ...(defaultSchema.attributes?.span || []),
      ['className', 'math', 'math-inline', 'math-display'],
    ],
    div: [
      ...(defaultSchema.attributes?.div || []),
      ['className', 'math', 'math-inline', 'math-display'],
    ],
  },
};

const REMARK_PLUGINS: PluggableList = [remarkGfm, remarkMath];
const FULL_REHYPE_PLUGINS: PluggableList = [
  rehypeRaw,
  [rehypeSanitize, sanitizeSchema],
  rehypeKatex,
];
const COMPACT_REHYPE_PLUGINS: PluggableList = [[rehypeSanitize, sanitizeSchema], rehypeKatex];

/** Resolves a local image src via the provided callback and renders as a base64 data URI. */
const ResolvedImage: React.FC<{
  src: string;
  alt: string;
  resolveImage: (src: string) => Promise<string | null>;
}> = ({ src, alt, resolveImage }) => {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    resolveImage(src)
      .then((result) => {
        if (cancelled) return;
        if (result) {
          setDataUrl(result);
        } else {
          setError(true);
        }
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [src, resolveImage]);

  if (error) {
    return (
      <span className="text-muted-foreground my-3 inline-block text-xs">
        [Image not found: {src}]
      </span>
    );
  }
  if (!dataUrl) {
    return (
      <span className="text-muted-foreground my-3 inline-block text-xs">Loading image...</span>
    );
  }
  return (
    <ExpandableImage
      src={dataUrl}
      alt={alt}
      containerClassName="my-3"
      className="max-w-full rounded"
    />
  );
};

type WithChildren = { children?: React.ReactNode };
type WithChildrenAndClass = { children?: React.ReactNode; className?: string };
type AnchorProps = { href?: string; children?: React.ReactNode };

function shouldConfirmExternalLinkClick(event: React.MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey;
}

type ImgProps = React.ComponentPropsWithoutRef<'img'> & ExtraProps;

function getCodeBlock(children: React.ReactNode, className?: string) {
  const language = /language-(\w+)/.exec(className || '')?.[1] ?? '';
  const isBlock = className?.includes('language-') ?? false;
  const code = String(children).replace(/\n$/, '');
  return { code, isBlock, language };
}

function renderMermaidCodeBlock(
  children: React.ReactNode,
  className: string | undefined,
  isDark: boolean,
  compact?: boolean
) {
  const { code, isBlock, language } = getCodeBlock(children, className);
  if (!isBlock || language !== 'mermaid') return null;
  return <MermaidDiagram chart={code} isDark={isDark} compact={compact} />;
}

function isOnlyMermaidDiagramChild(children: React.ReactNode): boolean {
  const child = Array.isArray(children) ? children[0] : children;
  return React.isValidElement(child) && child.type === MermaidDiagram;
}

function useFullComponents(
  isDark: boolean,
  resolveImage?: (src: string) => Promise<string | null>
) {
  return useMemo(
    () => ({
      h1: ({ children }: WithChildren) => (
        <h1 className="mt-6 mb-4 border-b border-border pb-2 text-2xl font-semibold text-foreground first:mt-0">
          {children}
        </h1>
      ),
      h2: ({ children }: WithChildren) => (
        <h2 className="mt-6 mb-3 border-b border-border pb-2 text-xl font-semibold text-foreground first:mt-0">
          {children}
        </h2>
      ),
      h3: ({ children }: WithChildren) => (
        <h3 className="mt-4 mb-2 text-lg font-semibold text-foreground">{children}</h3>
      ),
      h4: ({ children }: WithChildren) => (
        <h4 className="mt-4 mb-2 text-base font-semibold text-foreground">{children}</h4>
      ),
      h5: ({ children }: WithChildren) => (
        <h5 className="mt-3 mb-1 text-sm font-semibold text-foreground">{children}</h5>
      ),
      h6: ({ children }: WithChildren) => (
        <h6 className="text-muted-foreground mt-3 mb-1 text-sm font-semibold">{children}</h6>
      ),
      p: ({ children }: WithChildren) => (
        <p className="mb-3 text-sm leading-relaxed text-foreground">{children}</p>
      ),
      ul: ({ children }: WithChildren) => (
        <ul className="mb-3 ml-6 list-disc space-y-1 text-sm text-foreground">{children}</ul>
      ),
      ol: ({ children }: WithChildren) => (
        <ol className="mb-3 ml-6 list-decimal space-y-1 text-sm text-foreground">{children}</ol>
      ),
      li: ({ children }: WithChildren) => <li className="leading-relaxed">{children}</li>,
      code: ({ children, className }: WithChildrenAndClass) => {
        const mermaidBlock = renderMermaidCodeBlock(children, className, isDark);
        if (mermaidBlock) return mermaidBlock;

        const { code, isBlock, language } = getCodeBlock(children, className);
        if (isBlock) {
          return (
            <SyntaxHighlighter
              style={isDark ? oneDark : oneLight}
              language={language}
              PreTag="div"
              className="!my-0 !rounded-md !text-xs"
            >
              {code}
            </SyntaxHighlighter>
          );
        }

        return <code className="bg-muted rounded px-1.5 py-0.5 text-xs">{children}</code>;
      },
      pre: ({ children }: WithChildren) =>
        isOnlyMermaidDiagramChild(children) ? (
          <>{children}</>
        ) : (
          <pre className="mb-3 overflow-x-auto rounded-md border border-border">{children}</pre>
        ),
      a: ({ href, children }: AnchorProps) => {
        const isHttp = typeof href === 'string' && /^https?:\/\//i.test(href);
        const handleClick = (e: React.MouseEvent) => {
          if (isHttp && shouldConfirmExternalLinkClick(e)) {
            e.preventDefault();
            confirmOpenExternalLink(href);
          }
        };
        return (
          <a
            href={href}
            className="text-primary decoration-primary/50 hover:decoration-primary underline"
            target="_blank"
            rel="noopener noreferrer"
            onClick={handleClick}
          >
            {children}
          </a>
        );
      },
      blockquote: ({ children }: WithChildren) => (
        <blockquote className="bg-muted/30 text-muted-foreground mb-3 border-l-4 border-border py-1 pl-4 text-sm italic">
          {children}
        </blockquote>
      ),
      table: ({ children }: WithChildren) => (
        <div className="mb-3 overflow-x-auto">
          <table className="w-full border-collapse text-sm">{children}</table>
        </div>
      ),
      thead: ({ children }: WithChildren) => (
        <thead className="bg-muted/30 border-b border-border">{children}</thead>
      ),
      th: ({ children }: WithChildren) => (
        <th className="px-3 py-2 text-left font-semibold text-foreground">{children}</th>
      ),
      td: ({ children }: WithChildren) => (
        <td className="border-t border-border px-3 py-2 text-foreground">{children}</td>
      ),
      hr: () => <hr className="my-6 border-border" />,
      img: ({ node: _node, src, alt, className, ...props }: ImgProps) => {
        const isExternal = typeof src === 'string' && /^https?:\/\//i.test(src);
        if (!isExternal && resolveImage && src) {
          return <ResolvedImage src={src} alt={alt || ''} resolveImage={resolveImage} />;
        }
        return (
          <ExpandableImage
            src={src}
            alt={alt || ''}
            containerClassName="my-3"
            className={cn('max-w-full rounded', className)}
            {...props}
          />
        );
      },
      strong: ({ children }: WithChildren) => (
        <strong className="font-semibold text-foreground">{children}</strong>
      ),
      input: ({ checked, ...props }: React.ComponentPropsWithoutRef<'input'>) => (
        <input
          type="checkbox"
          checked={checked}
          disabled
          className="mr-2 align-middle"
          {...props}
        />
      ),
    }),
    [isDark, resolveImage]
  );
}

function useCompactComponents(isDark: boolean) {
  return useMemo(
    () => ({
      h1: ({ children }: WithChildren) => (
        <h2 className="mt-3 mb-1 text-sm font-semibold text-foreground first:mt-0">{children}</h2>
      ),
      h2: ({ children }: WithChildren) => (
        <h3 className="mt-3 mb-1 text-sm font-semibold text-foreground first:mt-0">{children}</h3>
      ),
      h3: ({ children }: WithChildren) => (
        <h4 className="mt-2 mb-1 text-xs font-semibold text-foreground">{children}</h4>
      ),
      p: ({ children }: WithChildren) => <p className="mb-2 leading-relaxed">{children}</p>,
      ul: ({ children }: WithChildren) => (
        <ul className="marker:text-muted-foreground mb-2 ml-4 list-disc space-y-1">{children}</ul>
      ),
      ol: ({ children }: WithChildren) => (
        <ol className="marker:text-muted-foreground mb-2 ml-4 list-decimal space-y-1">
          {children}
        </ol>
      ),
      li: ({ children }: WithChildren) => <li className="leading-relaxed">{children}</li>,
      code: ({ children, className }: WithChildrenAndClass) => {
        const mermaidBlock = renderMermaidCodeBlock(children, className, isDark, true);
        if (mermaidBlock) return mermaidBlock;

        const { isBlock } = getCodeBlock(children, className);
        if (isBlock) {
          return (
            <code className="bg-muted/60 block overflow-x-auto rounded-md border border-border p-2 text-[11px] leading-relaxed">
              {children}
            </code>
          );
        }
        return (
          <code className="bg-muted/60 rounded px-1 py-0.5 font-mono text-[0.92em]">
            {children}
          </code>
        );
      },
      pre: ({ children }: WithChildren) =>
        isOnlyMermaidDiagramChild(children) ? (
          <>{children}</>
        ) : (
          <pre className="mb-2 overflow-x-auto">{children}</pre>
        ),
      blockquote: ({ children }: WithChildren) => (
        <blockquote className="text-muted-foreground mb-2 border-l-2 border-border pl-3 italic">
          {children}
        </blockquote>
      ),
      table: ({ children }: WithChildren) => (
        <div className="my-3 overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-max border-collapse text-left text-[11px] leading-snug">
            {children}
          </table>
        </div>
      ),
      thead: ({ children }: WithChildren) => (
        <thead className="bg-muted/50 border-b border-border text-foreground">{children}</thead>
      ),
      th: ({ children }: WithChildren) => (
        <th className="border-r border-border px-2.5 py-1.5 font-semibold last:border-r-0">
          {children}
        </th>
      ),
      td: ({ children }: WithChildren) => (
        <td className="border-t border-r border-border px-2.5 py-1.5 align-top last:border-r-0">
          {children}
        </td>
      ),
      hr: () => <hr className="my-4 border-border" />,
      strong: ({ children }: WithChildren) => (
        <strong className="font-semibold text-foreground">{children}</strong>
      ),
      a: ({ href, children }: AnchorProps) => {
        const isHttp = typeof href === 'string' && /^https?:\/\//i.test(href);
        const handleClick = (e: React.MouseEvent) => {
          if (isHttp && shouldConfirmExternalLinkClick(e)) {
            e.preventDefault();
            confirmOpenExternalLink(href);
          }
        };
        return (
          <a
            href={href}
            className="text-primary underline"
            target="_blank"
            rel="noopener noreferrer"
            onClick={handleClick}
          >
            {children}
          </a>
        );
      },
      img: ({ node: _node, src, alt, className, ...props }: ImgProps) => (
        <ExpandableImage
          src={src}
          alt={alt || ''}
          containerClassName="my-2"
          className={cn('h-auto max-h-80 max-w-full rounded', className)}
          {...props}
        />
      ),
    }),
    [isDark]
  );
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  content,
  variant = 'full',
  className,
  allowHtml = variant === 'full',
  resolveImage,
}) => {
  const { effectiveTheme } = useTheme();
  const isDark = effectiveTheme === 'emdark';

  const fullComponents = useFullComponents(isDark, resolveImage);
  const compactComponents = useCompactComponents(isDark);

  const components = variant === 'full' ? fullComponents : compactComponents;
  const rehypePlugins = allowHtml ? FULL_REHYPE_PLUGINS : COMPACT_REHYPE_PLUGINS;
  const normalizedContent = useMemo(() => normalizeLatexDelimiters(content), [content]);

  return (
    <div className={cn(className)}>
      <Markdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={rehypePlugins}
        components={components}
      >
        {normalizedContent}
      </Markdown>
    </div>
  );
};
