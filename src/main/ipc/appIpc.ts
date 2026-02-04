import { app, ipcMain, shell } from "electron";
import { readFile } from "fs/promises";
import { join } from "path";
import { isDev } from "../utils/dev";

let cachedVersion: string | null = null;
let cachedVersionPromise: Promise<string> | null = null;

const resolveAppVersion = async (): Promise<string> => {
  if (!isDev) {
    return app.getVersion();
  }

  try {
    const packageJsonPath = join(process.cwd(), "package.json");
    const contents = await readFile(packageJsonPath, "utf8");
    const parsed = JSON.parse(contents);
    if (parsed?.version && typeof parsed.version === "string") {
      return parsed.version;
    }
  } catch {}

  return app.getVersion();
};

const getCachedVersion = (): Promise<string> => {
  if (cachedVersion) {
    return Promise.resolve(cachedVersion);
  }

  if (!cachedVersionPromise) {
    cachedVersionPromise = resolveAppVersion().then((version) => {
      cachedVersion = version;
      return version;
    });
  }

  return cachedVersionPromise;
};

export function registerAppIpc() {
  // Warm the cache at startup without blocking IPC registration.
  void getCachedVersion();

  // Open external links in default browser
  ipcMain.handle("app:openExternal", async (_event, url: string) => {
    try {
      if (!url || typeof url !== "string") throw new Error("Invalid URL");
      await shell.openExternal(url);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error?.message || String(error) };
    }
  });

  // App metadata
  ipcMain.handle("app:getVersion", () => getCachedVersion());
  ipcMain.handle("app:getPlatform", () => process.platform);
}
