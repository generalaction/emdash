import React, { useEffect, useMemo, useState } from 'react';
import Markdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import type { PluggableList } from 'unified';
import { useTheme } from '@renderer/lib/hooks/useTheme';
import { rpc } from '@renderer/lib/ipc';
import { cn } from '@renderer/utils/utils';

type Variant = 'full' | 'compact';

interface MarkdownRendererProps {
  content: string;
  variant?: Variant;
  className?: string;
  /**
   * Optional callback for resolving non-external image src values (e.g. relative
   * paths inside a workspace). Should return a `data:` URI string, or `null` to
   * render a "not found" placeholder. When omitted, local images are not resolved.
   */
  resolveImage?: (src: string) => Promise<string | null>;
}

/** Sanitize schema that also allows data: URIs on images */
const sanitizeSchema = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    src: [...(defaultSchema.protocols?.src || []), 'data'],
  },
};

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
      <span className="my-3 inline-block text-xs text-muted-foreground">
        [Image not found: {src}]
      </span>
    );
  }
  if (!dataUrl) {
    return (
      <span className="my-3 inline-block text-xs text-muted-foreground">Loading image...</span>
    );
  }
  return <img src={dataUrl} alt={alt} className="my-3 max-w-full rounded" />;
};

type WithChildren = { children?: React.ReactNode };
type WithChildrenAndClass = { children?: React.ReactNode; className?: string };
type AnchorProps = { href?: string; children?: React.ReactNode };
type ImgProps = { src?: string; alt?: string };

function useFullComponents(
  isDark: boolean,
  resolveImage?: (src: string) => Promise<string | null>
) {
  return useMemo(
    () => ({
      h1: ({ children }: WithChildren) => (
        <h1 className="mb-4 mt-6 border-b border-border pb-2 text-2xl font-semibold text-foreground first:mt-0">
          {children}
        </h1>
      ),
      h2: ({ children }: WithChildren) => (
        <h2 className="mb-3 mt-6 border-b border-border pb-2 text-xl font-semibold text-foreground first:mt-0">
          {children}
        </h2>
      ),
      h3: ({ children }: WithChildren) => (
        <h3 className="mb-2 mt-4 text-lg font-semibold text-foreground">{children}</h3>
      ),
      h4: ({ children }: WithChildren) => (
        <h4 className="mb-2 mt-4 text-base font-semibold text-foreground">{children}</h4>
      ),
      h5: ({ children }: WithChildren) => (
        <h5 className="mb-1 mt-3 text-sm font-semibold text-foreground">{children}</h5>
      ),
      h6: ({ children }: WithChildren) => (
        <h6 className="mb-1 mt-3 text-sm font-semibold text-muted-foreground">{children}</h6>
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
        const match = /language-(\w+)/.exec(className || '');
        const language = match ? match[1] : '';
        const isBlock = className?.includes('language-');

        if (isBlock) {
          return (
            <SyntaxHighlighter
              style={isDark ? oneDark : oneLight}
              language={language}
              PreTag="div"
              className="!my-0 !rounded-md !text-xs"
            >
              {String(children).replace(/\n$/, '')}
            </SyntaxHighlighter>
          );
        }

        return <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{children}</code>;
      },
      pre: ({ children }: WithChildren) => (
        <pre className="mb-3 overflow-x-auto rounded-md border border-border">{children}</pre>
      ),
      a: ({ href, children }: AnchorProps) => {
        const isHttp = typeof href === 'string' && /^https?:\/\//i.test(href);
        const handleClick = (e: React.MouseEvent) => {
          if (isHttp) {
            e.preventDefault();
            rpc.app.openExternal(href).catch(() => {});
          }
        };
        return (
          <a
            href={href}
            className="text-primary underline decoration-primary/50 hover:decoration-primary"
            target="_blank"
            rel="noopener noreferrer"
            onClick={handleClick}
          >
            {children}
          </a>
        );
      },
      blockquote: ({ children }: WithChildren) => (
        <blockquote className="mb-3 border-l-4 border-border bg-muted/30 py-1 pl-4 text-sm italic text-muted-foreground">
          {children}
        </blockquote>
      ),
      table: ({ children }: WithChildren) => (
        <div className="mb-3 overflow-x-auto">
          <table className="w-full border-collapse text-sm">{children}</table>
        </div>
      ),
      thead: ({ children }: WithChildren) => (
        <thead className="border-b border-border bg-muted/30">{children}</thead>
      ),
      th: ({ children }: WithChildren) => (
        <th className="px-3 py-2 text-left font-semibold text-foreground">{children}</th>
      ),
      td: ({ children }: WithChildren) => (
        <td className="border-t border-border px-3 py-2 text-foreground">{children}</td>
      ),
      hr: () => <hr className="my-6 border-border" />,
      img: ({ src, alt }: ImgProps) => {
        const isExternal = typeof src === 'string' && /^https?:\/\//i.test(src);
        if (!isExternal && resolveImage && src) {
          return <ResolvedImage src={src} alt={alt || ''} resolveImage={resolveImage} />;
        }
        return <img src={src} alt={alt || ''} className="my-3 max-w-full rounded" />;
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

function useCompactComponents() {
  return useMemo(
    () => ({
      h1: ({ children }: WithChildren) => (
        <h2 className="mb-1 mt-3 text-sm font-semibold text-foreground first:mt-0">{children}</h2>
      ),
      h2: ({ children }: WithChildren) => (
        <h3 className="mb-1 mt-3 text-sm font-semibold text-foreground first:mt-0">{children}</h3>
      ),
      h3: ({ children }: WithChildren) => (
        <h4 className="mb-1 mt-2 text-xs font-semibold text-foreground">{children}</h4>
      ),
      p: ({ children }: WithChildren) => <p className="mb-2 leading-relaxed">{children}</p>,
      ul: ({ children }: WithChildren) => (
        <ul className="mb-2 ml-4 list-disc space-y-0.5">{children}</ul>
      ),
      ol: ({ children }: WithChildren) => (
        <ol className="mb-2 ml-4 list-decimal space-y-0.5">{children}</ol>
      ),
      li: ({ children }: WithChildren) => <li className="leading-relaxed">{children}</li>,
      code: ({ children, className }: WithChildrenAndClass) => {
        const isBlock = className?.includes('language-');
        return isBlock ? (
          <code className="block overflow-x-auto rounded bg-muted/60 p-2 text-[11px]">
            {children}
          </code>
        ) : (
          <code className="rounded bg-muted/60 px-1 py-0.5 text-[11px]">{children}</code>
        );
      },
      pre: ({ children }: WithChildren) => <pre className="mb-2 overflow-x-auto">{children}</pre>,
      strong: ({ children }: WithChildren) => (
        <strong className="font-semibold text-foreground">{children}</strong>
      ),
      a: ({ href, children }: AnchorProps) => {
        const isHttp = typeof href === 'string' && /^https?:\/\//i.test(href);
        const handleClick = (e: React.MouseEvent) => {
          if (isHttp) {
            e.preventDefault();
            rpc.app.openExternal(href).catch(() => {});
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
    }),
    []
  );
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  content,
  variant = 'full',
  className,
  resolveImage,
}) => {
  const { effectiveTheme } = useTheme();
  const isDark = effectiveTheme === 'emdark';

  const fullComponents = useFullComponents(isDark, resolveImage);
  const compactComponents = useCompactComponents();

  const components = variant === 'full' ? fullComponents : compactComponents;
  const rehypePlugins: PluggableList =
    variant === 'full'
      ? [rehypeRaw, [rehypeSanitize, sanitizeSchema]]
      : [[rehypeSanitize, sanitizeSchema]];

  return (
    <div className={cn(className)}>
      <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={rehypePlugins} components={components}>
        {content}
      </Markdown>
    </div>
  );
};
