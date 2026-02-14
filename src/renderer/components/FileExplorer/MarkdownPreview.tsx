import React, { useMemo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useTheme } from '@/hooks/useTheme';

interface MarkdownPreviewProps {
  content: string;
}

export const MarkdownPreview: React.FC<MarkdownPreviewProps> = ({ content }) => {
  const { effectiveTheme } = useTheme();
  const isDark = effectiveTheme === 'dark' || effectiveTheme === 'dark-black';

  const components = useMemo(
    () => ({
      h1: ({ children }: any) => (
        <h1 className="mb-4 mt-6 border-b border-border pb-2 text-2xl font-semibold text-foreground first:mt-0">
          {children}
        </h1>
      ),
      h2: ({ children }: any) => (
        <h2 className="mb-3 mt-6 border-b border-border pb-2 text-xl font-semibold text-foreground first:mt-0">
          {children}
        </h2>
      ),
      h3: ({ children }: any) => (
        <h3 className="mb-2 mt-4 text-lg font-semibold text-foreground">{children}</h3>
      ),
      h4: ({ children }: any) => (
        <h4 className="mb-2 mt-4 text-base font-semibold text-foreground">{children}</h4>
      ),
      h5: ({ children }: any) => (
        <h5 className="mb-1 mt-3 text-sm font-semibold text-foreground">{children}</h5>
      ),
      h6: ({ children }: any) => (
        <h6 className="mb-1 mt-3 text-sm font-semibold text-muted-foreground">{children}</h6>
      ),
      p: ({ children }: any) => (
        <p className="mb-3 text-sm leading-relaxed text-foreground">{children}</p>
      ),
      ul: ({ children }: any) => (
        <ul className="mb-3 ml-6 list-disc space-y-1 text-sm text-foreground">{children}</ul>
      ),
      ol: ({ children }: any) => (
        <ol className="mb-3 ml-6 list-decimal space-y-1 text-sm text-foreground">{children}</ol>
      ),
      li: ({ children }: any) => <li className="leading-relaxed">{children}</li>,
      code: ({ children, className }: any) => {
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

        return (
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{children}</code>
        );
      },
      pre: ({ children }: any) => (
        <pre className="mb-3 overflow-x-auto rounded-md border border-border">{children}</pre>
      ),
      a: ({ href, children }: any) => (
        <a
          href={href}
          className="text-primary underline decoration-primary/50 hover:decoration-primary"
          target="_blank"
          rel="noopener noreferrer"
        >
          {children}
        </a>
      ),
      blockquote: ({ children }: any) => (
        <blockquote className="mb-3 border-l-4 border-border bg-muted/30 py-1 pl-4 text-sm italic text-muted-foreground">
          {children}
        </blockquote>
      ),
      table: ({ children }: any) => (
        <div className="mb-3 overflow-x-auto">
          <table className="w-full border-collapse text-sm">{children}</table>
        </div>
      ),
      thead: ({ children }: any) => (
        <thead className="border-b border-border bg-muted/30">{children}</thead>
      ),
      th: ({ children }: any) => (
        <th className="px-3 py-2 text-left font-semibold text-foreground">{children}</th>
      ),
      td: ({ children }: any) => (
        <td className="border-t border-border px-3 py-2 text-foreground">{children}</td>
      ),
      hr: () => <hr className="my-6 border-border" />,
      img: ({ src, alt }: any) => (
        <img src={src} alt={alt || ''} className="my-3 max-w-full rounded" />
      ),
      strong: ({ children }: any) => (
        <strong className="font-semibold text-foreground">{children}</strong>
      ),
      input: ({ checked, ...props }: any) => (
        <input
          type="checkbox"
          checked={checked}
          disabled
          className="mr-2 align-middle"
          {...props}
        />
      ),
    }),
    [isDark]
  );

  return (
    <div className="flex flex-1 overflow-auto bg-background">
      <div className="mx-auto w-full max-w-3xl px-8 py-8">
        <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={components}>
          {content}
        </Markdown>
      </div>
    </div>
  );
};
