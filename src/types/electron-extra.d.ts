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
      planApplyLock: (
        taskPath: string
      ) => Promise<{ success: boolean; changed?: number; error?: string }>;
      planReleaseLock: (
        taskPath: string
      ) => Promise<{ success: boolean; restored?: number; error?: string }>;
      onPlanEvent: (
        listener: (data: {
          type: 'write_blocked' | 'remove_blocked';
          root: string;
          relPath: string;
          code?: string;
          message?: string;
        }) => void
      ) => () => void;
    };
  }
}
