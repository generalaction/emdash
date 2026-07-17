declare module 'react-syntax-highlighter';
declare module 'react-syntax-highlighter/dist/esm/styles/prism';

declare global {
  interface Window {
    electronAPI: {
      getPathForFile: (file: File) => string;
      requestWirePort: (channel: string) => Promise<void>;
    };
  }
}

export {};
