export type BrowserWebviewEventMap = {
  'dom-ready': Event;
  'did-start-loading': Event;
  'did-stop-loading': Event;
  'did-navigate': { url: string };
  'did-navigate-in-page': { url: string };
  'did-fail-load': { errorCode: number; errorDescription: string; validatedURL: string };
  'console-message': { level: number; message: string; line: number; sourceId: string };
  'page-title-updated': { title: string };
  'page-favicon-updated': { favicons: string[] };
  'found-in-page': { result: BrowserFindResult };
};

export type BrowserFindResult = {
  requestId: number;
  activeMatchOrdinal: number;
  matches: number;
  finalUpdate?: boolean;
};

export type BrowserStopFindInPageAction = 'clearSelection' | 'keepSelection' | 'activateSelection';

export type BrowserWebviewElement = HTMLElement & {
  canGoBack(): boolean;
  canGoForward(): boolean;
  getURL(): string;
  getTitle(): string;
  getWebContentsId(): number;
  goBack(): void;
  goForward(): void;
  reload(): void;
  reloadIgnoringCache(): void;
  stop(): void;
  loadURL(url: string): Promise<void> | void;
  setZoomFactor(factor: number): void;
  findInPage(text: string, options?: Electron.FindInPageOptions): number;
  stopFindInPage(action: BrowserStopFindInPageAction): void;
  addEventListener<K extends keyof BrowserWebviewEventMap>(
    type: K,
    listener: (event: BrowserWebviewEventMap[K]) => void
  ): void;
  removeEventListener<K extends keyof BrowserWebviewEventMap>(
    type: K,
    listener: (event: BrowserWebviewEventMap[K]) => void
  ): void;
};

export type BrowserWebviewAdapter = {
  canGoBack(): boolean;
  canGoForward(): boolean;
  currentUrl(): string;
  title(): string;
  goBack(): void;
  goForward(): void;
  reload(): void;
  reloadIgnoringCache(): void;
  stop(): void;
  loadUrl(url: string): Promise<void>;
  setZoomFactor(factor: number): void;
  findInPage(text: string, options?: Electron.FindInPageOptions): number;
  stopFindInPage(action: BrowserStopFindInPageAction): void;
  onFoundInPage(listener: (result: BrowserFindResult) => void): () => void;
  focus(): void;
};

export function createBrowserWebviewAdapter(webview: BrowserWebviewElement): BrowserWebviewAdapter {
  return {
    canGoBack: () => webview.canGoBack(),
    canGoForward: () => webview.canGoForward(),
    currentUrl: () => webview.getURL(),
    title: () => webview.getTitle(),
    goBack: () => webview.goBack(),
    goForward: () => webview.goForward(),
    reload: () => webview.reload(),
    reloadIgnoringCache: () => webview.reloadIgnoringCache(),
    stop: () => webview.stop(),
    loadUrl: async (url: string) => {
      await webview.loadURL(url);
    },
    setZoomFactor: (factor: number) => webview.setZoomFactor(factor),
    findInPage: (text, options) => webview.findInPage(text, options),
    stopFindInPage: (action) => webview.stopFindInPage(action),
    onFoundInPage: (listener) => {
      const onFoundInPage = (event: BrowserWebviewEventMap['found-in-page']) => {
        listener(event.result);
      };
      webview.addEventListener('found-in-page', onFoundInPage);
      return () => webview.removeEventListener('found-in-page', onFoundInPage);
    },
    focus: () => webview.focus(),
  };
}
