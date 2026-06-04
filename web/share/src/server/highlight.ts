import { Marked, type Tokens } from 'marked';
import { createHighlighterCore, type HighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

// Shared skill markdown is attacker-controlled (anyone can POST a share), so the
// renderer drops raw HTML, refuses unsafe link protocols, and never emits images.
// Everything else is built from escaped text, our own tags, and shiki's escaped output.

const SAFE_LINK_PROTOCOL = /^(https?:|mailto:)/i;
const SHIKI_THEMES = { light: 'github-light', dark: 'github-dark' } as const;

let highlighterPromise: Promise<HighlighterCore> | null = null;

function getHighlighter(): Promise<HighlighterCore> {
  highlighterPromise ??= createHighlighterCore({
    themes: [import('@shikijs/themes/github-light'), import('@shikijs/themes/github-dark')],
    langs: [
      import('@shikijs/langs/bash'),
      import('@shikijs/langs/diff'),
      import('@shikijs/langs/javascript'),
      import('@shikijs/langs/json'),
      import('@shikijs/langs/markdown'),
      import('@shikijs/langs/python'),
      import('@shikijs/langs/typescript'),
      import('@shikijs/langs/yaml'),
    ],
    engine: createJavaScriptRegexEngine(),
  });
  return highlighterPromise;
}

export function stripFrontmatter(markdown: string): string {
  return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
}

export async function renderMarkdown(markdown: string): Promise<string> {
  const highlighter = await getHighlighter();

  const marked = new Marked({
    gfm: true,
    renderer: {
      html(): string {
        return '';
      },
      image(token: Tokens.Image): string {
        return escapeHtml(token.text);
      },
      link(token: Tokens.Link): string {
        const text = this.parser.parseInline(token.tokens);
        if (!SAFE_LINK_PROTOCOL.test(token.href)) return text;
        const title = token.title ? ` title="${escapeHtml(token.title)}"` : '';
        return `<a href="${escapeHtml(token.href)}"${title} rel="noreferrer">${text}</a>`;
      },
      code(token: Tokens.Code): string {
        const lang = token.lang?.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
        if (lang && highlighter.getLoadedLanguages().includes(lang)) {
          return highlighter.codeToHtml(token.text, { lang, themes: SHIKI_THEMES });
        }
        return `<pre><code>${escapeHtml(token.text)}</code></pre>`;
      },
    },
  });

  return marked.parse(markdown, { async: false });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
