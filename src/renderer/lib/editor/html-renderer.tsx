import { observer } from 'mobx-react-lite';
import { useEffect, useRef, useState } from 'react';
import { useProvisionedTask, useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import { HTML_EXTS } from '@renderer/lib/editor/fileKind';
import { PreviewSourceToggle } from '@renderer/lib/editor/preview-source-toggle';
import { rpc } from '@renderer/lib/ipc';
import { modelRegistry } from '@renderer/lib/monaco/monaco-model-registry';
import { buildMonacoModelPath } from '@renderer/lib/monaco/monacoModelPath';

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
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#')) return;
    e.preventDefault();
    try { parent.postMessage({ type: ${JSON.stringify(LINK_INTERCEPT_MESSAGE_TYPE)}, href: href }, '*'); } catch(_){}
  }, true);
  // Also block form submits which would otherwise navigate the iframe.
  document.addEventListener('submit', function(e){ e.preventDefault(); }, true);
})();
`;

export const HtmlRenderer = observer(function HtmlRenderer({ filePath }: HtmlRendererProps) {
  const { projectId } = useTaskViewContext();
  const provisioned = useProvisionedTask();
  const { workspaceId } = provisioned;
  const { editorView, tabManager } = provisioned.taskView;
  const bufferUri = buildMonacoModelPath(editorView.modelRootPath, filePath);

  // Touch bufferVersions so this observer re-renders when the buffer is first
  // populated — otherwise the preview can stick on stale content.
  void modelRegistry.bufferVersions.get(bufferUri);
  const rawContent = modelRegistry.getValue(bufferUri) ?? '';
  const fileDir = filePath.includes('/') ? filePath.substring(0, filePath.lastIndexOf('/')) : '';
  const fileName = filePath.split('/').pop() ?? filePath;

  const [processed, setProcessed] = useState<{ filePath: string; html: string } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // Process the raw HTML: inline relative <link>/<script>/<img>/<source>
  // resources and inject a script that intercepts <a> link clicks to
  // postMessage the parent.
  // We keep the previous `processed` value visible while reprocessing so the
  // iframe doesn't flash to "Loading…" on every keystroke.
  useEffect(() => {
    if (!rawContent) {
      setProcessed(null);
      return;
    }
    let cancelled = false;
    setIsProcessing(true);
    void processHtmlForPreview(rawContent, fileDir, projectId, workspaceId)
      .then((html) => {
        if (!cancelled) setProcessed({ filePath, html });
      })
      .catch(() => {
        if (!cancelled) setProcessed({ filePath, html: rawContent });
      })
      .finally(() => {
        if (!cancelled) setIsProcessing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [rawContent, fileDir, filePath, projectId, workspaceId]);

  // Listen for link-click postMessages from the sandboxed iframe and route them
  // through the tab manager so other HTML files open as new tabs.
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.source !== iframeRef.current?.contentWindow) return;
      const data = e.data as { type?: string; href?: string } | null;
      if (!data || data.type !== LINK_INTERCEPT_MESSAGE_TYPE || typeof data.href !== 'string')
        return;
      const target = resolveRelativePath(fileDir, data.href);
      if (!target) return;
      const ext = target.split('.').pop()?.toLowerCase() ?? '';
      if (HTML_EXTS.has(ext)) {
        tabManager.openFile(target);
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [fileDir, tabManager]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-background-secondary-1">
      {processed?.filePath === filePath ? (
        <iframe
          key={filePath}
          ref={iframeRef}
          title={fileName}
          srcDoc={processed.html}
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
      <PreviewSourceToggle
        activeMode="preview"
        onSwitch={(mode) => {
          if (mode === 'source') {
            tabManager.updateRenderer(filePath, () => ({ kind: 'html-source' }));
          }
        }}
      />
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
  fileDir: string,
  projectId: string,
  workspaceId: string
): Promise<string> {
  const doc = new DOMParser().parseFromString(rawHtml, 'text/html');
  if (!doc.documentElement) return rawHtml;

  const textCache = new Map<string, Promise<string | null>>();
  const imageCache = new Map<string, Promise<string | null>>();
  const fetchText = (path: string) => {
    let p = textCache.get(path);
    if (!p) {
      p = readWorkspaceText(projectId, workspaceId, path);
      textCache.set(path, p);
    }
    return p;
  };
  const fetchImage = (path: string) => {
    let p = imageCache.get(path);
    if (!p) {
      p = readWorkspaceImage(projectId, workspaceId, path);
      imageCache.set(path, p);
    }
    return p;
  };

  // <link rel="stylesheet" href="..."> → inline <style>
  const linkEls = Array.from(doc.querySelectorAll('link[rel~="stylesheet"][href]'));
  await Promise.all(
    linkEls.map(async (el) => {
      const href = el.getAttribute('href');
      if (!href || isAbsoluteOrSpecial(href)) return;
      const resolved = resolveRelativePath(fileDir, href);
      if (!resolved) return;
      const css = await fetchText(resolved);
      if (css == null) return;
      const style = doc.createElement('style');
      style.textContent = css;
      el.replaceWith(style);
    })
  );

  // <script src="..."> → inline <script>
  const scriptEls = Array.from(doc.querySelectorAll('script[src]'));
  await Promise.all(
    scriptEls.map(async (el) => {
      const src = el.getAttribute('src');
      if (!src || isAbsoluteOrSpecial(src)) return;
      const resolved = resolveRelativePath(fileDir, src);
      if (!resolved) return;
      const js = await fetchText(resolved);
      if (js == null) return;
      const script = doc.createElement('script');
      // Preserve attributes like type="module"; src is dropped intentionally.
      for (const attr of Array.from(el.attributes)) {
        if (attr.name === 'src') continue;
        script.setAttribute(attr.name, attr.value);
      }
      script.textContent = js;
      el.replaceWith(script);
    })
  );

  // <img src="...">, <picture><source src="..."> → data URL. readImage only
  // supports image formats, so do not claim video/audio source support here.
  const mediaEls = Array.from(doc.querySelectorAll('img[src], picture source[src]'));
  await Promise.all(
    mediaEls.map(async (el) => {
      const src = el.getAttribute('src');
      if (!src || isAbsoluteOrSpecial(src)) return;
      const resolved = resolveRelativePath(fileDir, src);
      if (!resolved) return;
      const dataUrl = await fetchImage(resolved);
      if (dataUrl) el.setAttribute('src', dataUrl);
    })
  );

  // Inject the link-intercept script at the end of <body>.
  const interceptor = doc.createElement('script');
  interceptor.textContent = LINK_INTERCEPT_SCRIPT;
  (doc.body ?? doc.documentElement).appendChild(interceptor);

  return '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
}

async function readWorkspaceText(
  projectId: string,
  workspaceId: string,
  filePath: string
): Promise<string | null> {
  try {
    const result = await rpc.fs.readFile(projectId, workspaceId, filePath);
    if (!result.success) return null;
    return result.data?.content ?? null;
  } catch {
    return null;
  }
}

async function readWorkspaceImage(
  projectId: string,
  workspaceId: string,
  filePath: string
): Promise<string | null> {
  try {
    const result = await rpc.fs.readImage(projectId, workspaceId, filePath);
    if (!result.success) return null;
    return result.data?.dataUrl ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/** True for absolute URLs (http://, data:, mailto:, etc.) and root-anchored paths. */
function isAbsoluteOrSpecial(href: string): boolean {
  if (!href) return true;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return true;
  if (href.startsWith('//')) return true;
  if (href.startsWith('#')) return true;
  return false;
}

/**
 * Resolves a relative href against the directory of the host file. Returns
 * a workspace-relative path with no leading slash, or null if the path
 * escapes the workspace root.
 */
function resolveRelativePath(fileDir: string, href: string): string | null {
  if (!href) return null;
  const cleanHref = href.split('#')[0]?.split('?')[0] ?? '';
  if (!cleanHref) return null;

  // Absolute (root-anchored) paths resolve from workspace root.
  const segments = cleanHref.startsWith('/')
    ? cleanHref.slice(1).split('/')
    : [...(fileDir ? fileDir.split('/') : []), ...cleanHref.split('/')];

  const normalized: string[] = [];
  for (const seg of segments) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      if (normalized.length === 0) return null;
      normalized.pop();
      continue;
    }
    normalized.push(seg);
  }
  return normalized.join('/');
}
