declare global {
  interface Window {
    electronAPI: {
      getPathForFile: (file: File) => string;
      requestWirePort: (channel: string) => Promise<void>;
    };
  }
}

export {};
