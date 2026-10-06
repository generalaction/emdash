/**
 * Electron shim for the Emdash web server.
 *
 * The Emdash desktop backend (database, runtimes, services, wire controllers)
 * is Electron-agnostic except for a narrow surface: app paths, power monitor
 * events, shell/clipboard/dialog helpers, and window/tray/menu integration
 * that only the desktop shell exercises. This module replaces `electron`
 * inside the web server bundle so the same backend code boots under plain
 * Node.js.
 *
 * Path resolution is env-driven so the server controls its data layout:
 *   EMDASH_WEB_DATA_DIR  user-data directory (default ~/.emdash-web)
 *   EMDASH_WEB_APP_DIR   app root that hosts out/main worker bundles
 *                        (default: <bundle dir>/app)
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

function dataDir(): string {
  return resolve(process.env.EMDASH_WEB_DATA_DIR ?? join(homedir(), '.emdash-web'));
}

function appDir(): string {
  return resolve(process.env.EMDASH_WEB_APP_DIR ?? join(here, 'app'));
}

function noop(): void {
  /* intentionally empty */
}

function unsubscribe(): () => void {
  return () => undefined;
}

class StubEventEmitter {
  private listeners = new Map<string, Set<() => void>>();
  on(_event: string, cb: () => void): this {
    const set = this.listeners.get(_event) ?? new Set();
    set.add(cb);
    this.listeners.set(_event, set);
    return this;
  }
  once(_event: string, _cb: () => void): this {
    return this;
  }
  off(_event: string, cb: () => void): this {
    this.listeners.get(_event)?.delete(cb);
    return this;
  }
  removeListener(event: string, cb: () => void): this {
    return this.off(event, cb);
  }
  removeAllListeners(): this {
    this.listeners.clear();
    return this;
  }
  emit(event: string): boolean {
    for (const cb of this.listeners.get(event) ?? []) cb();
    return true;
  }
}

export const app = {
  getPath(name: string): string {
    switch (name) {
      case 'userData':
        return dataDir();
      case 'home':
        return homedir();
      case 'appData':
        return join(homedir(), '.config');
      case 'temp':
        return tmpdir();
      case 'appPath':
        return appDir();
      case 'exePath':
        return process.execPath;
      case 'logs':
        return join(dataDir(), 'logs');
      case 'desktop':
      case 'documents':
      case 'downloads':
        return homedir();
      default:
        return dataDir();
    }
  },
  getName(): string {
    return 'emdash-web';
  },
  getVersion(): string {
    return process.env.EMDASH_WEB_VERSION ?? '1.2.5-web';
  },
  getAppPath(): string {
    return appDir();
  },
  getAppMetrics(): Array<Record<string, unknown>> {
    return [];
  },
  isReady(): boolean {
    return true;
  },
  isPackaged(): boolean {
    return true;
  },
  whenReady(): Promise<void> {
    return Promise.resolve();
  },
  on: noop,
  once: noop,
  off: noop,
  removeListener: noop,
  quit(): void {
    void (async () => process.exit(0))();
  },
  exit(code = 0): void {
    process.exit(code);
  },
  relaunch(): void {
    noop();
  },
  commandLine: {
    appendSwitch: noop,
    appendArgument: noop,
  },
  setAppUserModelId: noop,
  setAboutPanelOptions: noop,
};

export const powerMonitor = {
  on: noop,
  once: noop,
  addListener: noop,
  removeListener: noop,
  onLockScreen: noop,
  onUnlockScreen: noop,
};

export const shell = {
  async openExternal(_url: string): Promise<void> {
    /* web server cannot open desktop browser */
  },
  async openPath(_path: string): Promise<string> {
    return '';
  },
  async showItemInFolder(_path: string): Promise<void> {
    noop();
  },
  async beep(): Promise<void> {
    noop();
  },
};

export const clipboard = {
  writeText(_text: string): void {
    noop();
  },
  readText(): string {
    return '';
  },
  clear(): void {
    noop();
  },
};

export const dialog = {
  async showMessageBox(): Promise<{ response: number; checkboxChecked: boolean }> {
    return { response: 0, checkboxChecked: false };
  },
  async showOpenDialog(): Promise<{ canceled: boolean; filePaths: string[] }> {
    return { canceled: true, filePaths: [] };
  },
  async showSaveDialog(): Promise<{ canceled: boolean; filePath?: string }> {
    return { canceled: true };
  },
  async showErrorBox(): Promise<void> {
    noop();
  },
};

export const Menu = {
  buildFromTemplate(): { popup: () => void; closePopup: () => void } {
    return { popup: noop, closePopup: noop };
  },
  setApplicationMenu(): void {
    noop();
  },
  getApplicationMenu(): null {
    return null;
  },
  sendActionToFirstResponder(): void {
    noop();
  },
};

type StubImage = {
  isEmpty: () => boolean;
  toDataURL: () => string;
  resize: (options?: { width?: number; height?: number }) => StubImage;
  getSize: () => { width: number; height: number };
  toPNG: () => Buffer;
  setTemplateImage: () => void;
};

function stubImage(): StubImage {
  const image: StubImage = {
    isEmpty: () => true,
    toDataURL: () => 'data:',
    resize: () => image,
    getSize: () => ({ width: 0, height: 0 }),
    toPNG: () => Buffer.alloc(0),
    setTemplateImage: () => undefined,
  };
  return image;
}

export const nativeImage = {
  createFromPath: (): StubImage => stubImage(),
  createEmpty: (): StubImage => stubImage(),
  createFromDataURL: (): StubImage => stubImage(),
  createFromBuffer: (): StubImage => stubImage(),
};

export const nativeTheme = {
  shouldUseDarkColors: false,
  themeSource: 'system' as string,
  on: noop,
  once: noop,
  off: noop,
};

export class Notification extends StubEventEmitter {
  static isSupported(): boolean {
    return false;
  }
  show(): void {
    noop();
  }
  close(): void {
    noop();
  }
}

/**
 * Web-server safeStorage: AES-256-GCM encryption backed by a 0600 key file in
 * the data directory. The desktop uses the OS keychain via Electron; the web
 * server has none, so a locally protected key file is the closest equivalent.
 * The reused EncryptedAppSecretsStore requires isEncryptionAvailable() and a
 * non-basic_text backend on Linux before every secret read/write.
 */
function webSafeStorage() {
  let key: Buffer | undefined;
  const keyPath = () => join(dataDir(), 'secret.key');

  function loadKey(): Buffer {
    if (key) return key;
    const file = keyPath();
    try {
      const existing = readFileSync(file);
      if (existing.byteLength === 32) {
        key = existing;
        return key;
      }
    } catch {
      /* first use — generate below */
    }
    const generated = randomBytes(32);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, generated, { mode: 0o600 });
    key = generated;
    return key;
  }

  return {
    isEncryptionAvailable(): boolean {
      return true;
    },
    getSelectedStorageBackend(): string {
      return 'web-file-key';
    },
    encryptString(plainText: string): Buffer {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', loadKey(), iv);
      const ciphertext = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      return Buffer.concat([iv, tag, ciphertext]);
    },
    decryptString(encrypted: Buffer): string {
      const iv = encrypted.subarray(0, 12);
      const tag = encrypted.subarray(12, 28);
      const ciphertext = encrypted.subarray(28);
      const decipher = createDecipheriv('aes-256-gcm', loadKey(), iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    },
  };
}

export const safeStorage = webSafeStorage();

export const net = {
  request(): StubEventEmitter & { write: () => void; end: () => void; on: () => unknown } {
    const emitter = new StubEventEmitter() as StubEventEmitter & {
      write: () => void;
      end: () => void;
      on: () => unknown;
    };
    emitter.write = noop;
    emitter.end = noop;
    return emitter;
  },
  isOnline(): boolean {
    return true;
  },
};

export const protocol = {
  registerSchemesAsPrivileged: noop,
  handle: noop,
  unregisterProtocol: noop,
};

export const systemPreferences = {
  getUserDefault(): string {
    return '';
  },
  on: noop,
  off: noop,
  subscribeNotification: unsubscribe,
};

export const contentTracing = {
  async startRecording(): Promise<void> {
    noop();
  },
  async stopRecording(): Promise<{ path?: string }> {
    return {};
  },
};

export const webContents = {
  fromId(): null {
    return null;
  },
  getAllWebContents(): Array<unknown> {
    return [];
  },
};

export const ipcMain = {
  handle: noop,
  handleOnce: noop,
  on: noop,
  once: noop,
  removeHandler: noop,
  removeAllListeners: noop,
};

export class MessageChannelMain {
  port1: unknown;
  port2: unknown;
  constructor() {
    this.port1 = undefined;
    this.port2 = undefined;
  }
}

export class BrowserWindow extends StubEventEmitter {
  static fromWebContents(): BrowserWindow | null {
    return null;
  }
  static getAllWindows(): BrowserWindow[] {
    return [];
  }
  static getFocusedWindow(): BrowserWindow | null {
    return null;
  }
  isDestroyed(): boolean {
    return true;
  }
  webContents = {
    send: noop,
    on: noop,
    once: noop,
    loadURL: async () => undefined,
  };
  destroy(): void {
    noop();
  }
  close(): void {
    noop();
  }
  minimize(): void {
    noop();
  }
  isMinimized(): boolean {
    return false;
  }
  isMaximized(): boolean {
    return false;
  }
  focus(): void {
    noop();
  }
}

export const session = {
  fromPartition(): null {
    return null;
  },
  defaultSession: null,
};

export const screen = {
  getPrimaryDisplay(): { bounds: { width: number; height: number } } {
    return { bounds: { width: 1920, height: 1080 } };
  },
};

export const TouchBar = {};
export const globalShortcut = {
  register: noop,
  unregister: noop,
  unregisterAll: noop,
  isRegistered: (): boolean => false,
};
export const Tray = class extends StubEventEmitter {
  destroy(): void {
    noop();
  }
  setToolTip(): void {
    noop();
  }
  setImage(): void {
    noop();
  }
  setContextMenu(): void {
    noop();
  }
};
export const utilityProcess = {
  fork(): StubEventEmitter {
    return new StubEventEmitter();
  },
};
export const parentPort = null;
export const contextBridge = {
  exposeInMainWorld: noop,
};
export const ipcRenderer = {
  on: noop,
  once: noop,
  send: noop,
  invoke: async () => undefined,
  removeListener: noop,
};
export const webUtils = {
  getPathForFile(): string {
    return '';
  },
};
