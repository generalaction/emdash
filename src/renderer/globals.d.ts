declare module 'react-syntax-highlighter';
declare module 'react-syntax-highlighter/dist/esm/styles/prism';

declare global {
  interface Window {
    electronAPI: {
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
      eventSend: (channel: string, data: unknown) => void;
      eventOn: (channel: string, cb: (data: unknown) => void) => () => void;
      getPathForFile: (file: File) => string;
    };
  }

}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'em-emoji': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        id?: string;
        shortcodes?: string;
        native?: string;
        size?: string | number;
        fallback?: string;
        set?: 'native' | 'apple' | 'facebook' | 'google' | 'twitter';
        skin?: number;
      };
    }
  }
}

export {};
