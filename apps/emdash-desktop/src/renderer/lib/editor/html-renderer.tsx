import { observer } from 'mobx-react-lite';
import { useEffect, useRef, useState } from 'react';
import { usePaneContext } from '@renderer/features/tabs/pane-context';
import { useWorkspace, useWorkspaceViewModel } from '@renderer/features/tasks/task-view-context';
import { HTML_EXTS } from '@renderer/lib/editor/fileKind';
import { modelRegistry } from '@renderer/lib/monaco/monaco-model-registry';
import { buildMonacoModelPath } from '@renderer/lib/monaco/monacoModelPath';
import { filesPath, readRuntimeImage } from '@renderer/lib/runtime/files';
import { getFilesRuntimeClient } from '@renderer/lib/runtime/files-client';
import { resolveWorkspaceResourcePath } from './workspace-resource-path';

interface HtmlRendererProps {
  filePath: string;
}

const LINK_INTERCEPT_MESSAGE_TYPE = 'emdash-html-link';

const LINK_INTERCEPT_SCRIPT = `
(function(){
  document.addEventListener('click', function(e){
    var a = e.target && e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    var href = a.getAttribute('href');
    if (!href) return;
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//') || href.startsWith('#')) return;
    e.preventDefault();
    try { parent.postMessage({ type: ${JSON.stringify(LINK_INTERCEPT_MESSAGE_TYPE)}, href: href }, '*'); } catch(_){}
  }, true);
  // Also block form submits which would otherwise navigate the iframe.
  document.addEventListener('submit', function(e){ e.preventDefault(); }, true);
})();
`;

/**
 * Renders an HTML file in a sandboxed iframe preview.
 * The source/preview toggle lives in the FileContent container above this component.
 */
export const HtmlRenderer = observer(function HtmlRenderer({ filePath }: HtmlRendererProps) {
  const workspacePath = useWorkspace().path;
  const { editorView } = useWorkspaceViewModel();
  const { pane } = usePaneContext();
  const bufferUri = buildMonacoModelPath(editorView.modelRootPath, filePath);

  // Touch bufferVersions so this observer re-renders when the buffer is first
  // populated — otherwise the preview can stick on stale content.
  void modelRegistry.bufferVersions.get(bufferUri);
  const rawContent = modelRegistry.getValue(bufferUri) ?? '';
  const fileName = filePath.split('/').pop() ?? filePath;

  const [processedHtml, setProcessedHtml] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // Keep the previous processed HTML visible while reprocessing so the iframe
  // doesn't flash to "Loading…" on every keystroke.
  useEffect(() => {
    if (!rawContent) {
      setProcessedHtml(null);
      setIsProcessing(false);
      return;
    }
    let cancelled = false;
    setIsProcessing(true);
    void processHtmlForPreview(rawContent, filePath, workspacePath)
      .then((html) => {
        if (!cancelled) setProcessedHtml(html);
      })
      .catch(() => {
        if (!cancelled) setProcessedHtml(rawContent);
      })
      .finally(() => {
        if (!cancelled) setIsProcessing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [rawContent, filePath, workspacePath]);

  // Route link clicks postMessaged from the sandbox into the tab manager so
  // sibling HTML files open as new tabs.
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.source !== iframeRef.current?.contentWindow) return;
      const data = e.data as { type?: string; href?: string } | null;
      if (!data || data.type !== LINK_INTERCEPT_MESSAGE_TYPE || typeof data.href !== 'string')
        return;
      const target = resolveWorkspaceResourcePath({
        workspacePath,
        containingFilePath: filePath,
        resourcePath: data.href,
      });
      if (!target) return;
      const ext = target.split('.').pop()?.toLowerCase() ?? '';
      if (HTML_EXTS.has(ext)) {
        pane.open('file', { path: target, preview: false });
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [filePath, workspacePath, pane]);

  return (
    <div className="h-full w-full overflow-hidden bg-background-secondary-1">
      {processedHtml !== null ? (
        <iframe
          ref={iframeRef}
          title={fileName}
          srcDoc={processedHtml}
          // allow-scripts: lets the link-intercept script and the page's own JS run.
          // No allow-same-origin: keeps the iframe an opaque origin so it can't read
          // host cookies / localStorage. Resources are inlined, so no network needed.
          sandbox="allow-scripts"
          className="h-full w-full border-0 bg-white"
        />
      ) : (
        <div className="flex h-full items-center justify-center text-xs text-foreground-passive">
          {isProcessing ? 'Loading preview…' : 'Empty file'}
        </div>
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------
// HTML processing
// ---------------------------------------------------------------------------

/**
 * Parses the raw HTML, replaces supported relative resources (CSS link,
 * script src, img src, and source src) with inline content fetched from the
 * workspace, and appends a script that intercepts in-page anchor clicks via
 * postMessage. Resources referenced multiple times (e.g. the same image used
 * in several places) are fetched only once per call.
 */
async function processHtmlForPreview(
  rawHtml: string,
  containingFilePath: string,
  workspacePath: string
): Promise<string> {
  const doc = new DOMParser().parseFromString(rawHtml, 'text/html');
  if (!doc.documentElement) return rawHtml;

  const textCache = new Map<string, Promise<string | null>>();
  const imageCache = new Map<string, Promise<string | null>>();
  const fetchText = (path: string) => {
    let p = textCache.get(path);
    if (!p) {
      p = readWorkspaceText(workspacePath, path);
      textCache.set(path, p);
    }
    return p;
  };
  const fetchImage = (path: string) => {
    let p = imageCache.get(path);
    if (!p) {
      p = readWorkspaceImage(workspacePath, path);
      imageCache.set(path, p);
    }
    return p;
  };

  const linkEls = Array.from(doc.querySelectorAll('link[rel~="stylesheet"][href]'));
  const scriptEls = Array.from(doc.querySelectorAll('script[src]'));
  // readImage only supports image formats, so don't claim video/audio support here.
  const mediaEls = Array.from(doc.querySelectorAll('img[src], picture source[src]'));

  await Promise.all([
    // <link rel="stylesheet" href="..."> → inline <style>
    ...linkEls.map(async (el) => {
      const href = el.getAttribute('href');
      if (!href) return;
      const resolved = resolveWorkspaceResourcePath({
        workspacePath,
        containingFilePath,
        resourcePath: href,
      });
      if (!resolved) return;
      const css = await fetchText(resolved);
      if (css == null) return;
      const style = doc.createElement('style');
      style.textContent = escapeStyleText(
        await inlineCssUrls(css, resolved, workspacePath, fetchImage)
      );
      el.replaceWith(style);
    }),
    // <script src="..."> → inline <script>
    ...scriptEls.map(async (el) => {
      const src = el.getAttribute('src');
      if (!src) return;
      const resolved = resolveWorkspaceResourcePath({
        workspacePath,
        containingFilePath,
        resourcePath: src,
      });
      if (!resolved) return;
      const js = await fetchText(resolved);
      if (js == null) return;
      const script = doc.createElement('script');
      // Preserve attributes like type="module"; src is dropped intentionally.
      for (const attr of Array.from(el.attributes)) {
        if (attr.name === 'src') continue;
        script.setAttribute(attr.name, attr.value);
      }
      script.textContent = escapeScriptText(js);
      el.replaceWith(script);
    }),
    // <img src="...">, <picture><source src="..."> → data URL.
    ...mediaEls.map(async (el) => {
      const src = el.getAttribute('src');
      if (!src) return;
      const resolved = resolveWorkspaceResourcePath({
        workspacePath,
        containingFilePath,
        resourcePath: src,
      });
      if (!resolved) return;
      const dataUrl = await fetchImage(resolved);
      if (dataUrl) el.setAttribute('src', dataUrl);
    }),
  ]);

  // Inject the link-intercept script at the end of <body>.
  const interceptor = doc.createElement('script');
  interceptor.textContent = LINK_INTERCEPT_SCRIPT;
  (doc.body ?? doc.documentElement).appendChild(interceptor);

  return '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
}

function escapeScriptText(js: string): string {
  return js.replace(/<\/script>/gi, '<\\/script>');
}

function escapeStyleText(css: string): string {
  return css.replace(/<\/style>/gi, '<\\/style>');
}

async function inlineCssUrls(
  css: string,
  cssFilePath: string,
  workspacePath: string | undefined,
  fetchImage: (path: string) => Promise<string | null>
): Promise<string> {
  const urlPattern = /url\(\s*(['"]?)([^'"()]+)\1\s*\)/g;
  const replacements = await Promise.all(
    Array.from(css.matchAll(urlPattern), async (match) => {
      const rawUrl = match[2]?.trim();
      if (!rawUrl) return null;

      const resolved = resolveWorkspaceResourcePath({
        workspacePath,
        containingFilePath: cssFilePath,
        resourcePath: rawUrl,
      });
      if (!resolved) return null;

      const dataUrl = await fetchImage(resolved);
      return dataUrl ? { from: match[0], to: `url("${dataUrl}")` } : null;
    })
  );

  return replacements.reduce((nextCss, replacement) => {
    return replacement ? nextCss.replace(replacement.from, replacement.to) : nextCss;
  }, css);
}

async function readWorkspaceText(workspacePath: string, filePath: string): Promise<string | null> {
  const client = await getFilesRuntimeClient();
  const result = await client.fs.readText(filesPath(workspacePath, filePath));
  return result.success ? result.data.content : null;
}

async function readWorkspaceImage(workspacePath: string, filePath: string): Promise<string | null> {
  const result = await readRuntimeImage(workspacePath, filePath);
  return result.success && !result.data.truncated ? result.data.dataUrl : null;
}
