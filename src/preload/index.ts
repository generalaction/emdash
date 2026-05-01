import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { contextBridge, ipcRenderer, webUtils } from 'electron';

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg']);

function extensionForFile(file: File): string {
  const nameExt = extname(file.name).toLowerCase();
  if (IMAGE_EXTENSIONS.has(nameExt)) return nameExt;
  const typeExt = file.type.startsWith('image/') ? `.${file.type.slice('image/'.length)}` : '.png';
  return IMAGE_EXTENSIONS.has(typeExt) ? typeExt : '.png';
}

function safeFileName(file: File): string {
  const rawName = basename(file.name || `image-${randomUUID()}${extensionForFile(file)}`);
  const ext = extensionForFile(file);
  const name = extname(rawName) ? rawName : `${rawName}${ext}`;
  return name.replace(/[^a-zA-Z0-9._ -]/g, '_');
}

// Expose protected methods that allow the renderer process to use
contextBridge.exposeInMainWorld('electronAPI', {
  // Generic invoke for the typed RPC client (createRPCClient)
  invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
  // Generic event bridge for the typesafe event emitter (createEventEmitter)
  eventSend: (channel: string, data: unknown) => ipcRenderer.send(channel, data),
  eventOn: (channel: string, cb: (data: unknown) => void) => {
    const wrapped = (_: Electron.IpcRendererEvent, data: unknown) => cb(data);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
  getPathForFile: (file: File) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return '';
    }
  },
  getPathForFileOrSave: async (file: File) => {
    try {
      const existingPath = webUtils.getPathForFile(file);
      if (existingPath) return existingPath;
    } catch {
      // Fall through to persisting clipboard-backed files.
    }

    const dir = join(tmpdir(), 'emdash-initial-prompt-images');
    await mkdir(dir, { recursive: true });
    const path = join(dir, `${randomUUID()}-${safeFileName(file)}`);
    await writeFile(path, Buffer.from(await file.arrayBuffer()));
    return path;
  },
});
