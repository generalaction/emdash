/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly MAIN_VITE_APP_VERSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
