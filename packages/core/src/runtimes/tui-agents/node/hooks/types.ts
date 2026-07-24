export interface RawHookRequest {
  ptyId: string;
  type: string;
  body: string;
}

export type HookHandler = (raw: RawHookRequest) => Promise<void>;

export type HookInstallPolicy = {
  writeGitIgnoreEntries?: boolean;
};

export type HookServerHandle = {
  port: number;
  token: string;
};
