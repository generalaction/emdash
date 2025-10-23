export {};

declare global {
  interface Window {
    electronAPI: {
      fsWriteFile: (
        root: string,
        relPath: string,
        content: string,
        mkdirs?: boolean
      ) => Promise<{ success: boolean; error?: string }>;
      fsRemove: (root: string, relPath: string) => Promise<{ success: boolean; error?: string }>;
    };
  }
}

