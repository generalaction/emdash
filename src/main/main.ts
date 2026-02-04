import { execFile } from "child_process";
import { app, nativeImage } from "electron";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { createMainWindow } from "./app/window";
import { registerAppLifecycle } from "./app/lifecycle";
import { registerAllIpc } from "./ipc";
import { databaseService } from "./services/DatabaseService";

const LOGIN_SHELL_PATH_TIMEOUT_MS = 2500;

const refreshPathFromLoginShell = () => {
  if (process.platform !== "darwin") {
    return;
  }

  const shell = process.env.SHELL || "/bin/zsh";
  let timedOut = false;
  let timeout: NodeJS.Timeout | undefined;

  const child = execFile(
    shell,
    ["-lc", 'printf "%s" "$PATH"'],
    (error, stdout) => {
      if (timeout) {
        clearTimeout(timeout);
      }
      if (timedOut) {
        return;
      }
      if (error) {
        console.warn("Login shell PATH lookup failed:", error.message || error);
        return;
      }

      const nextPath = stdout.trim();
      if (nextPath.length > 0) {
        process.env.PATH = nextPath;
      }
    },
  );

  timeout = setTimeout(() => {
    child.kill("SIGKILL");
    timedOut = true;
    console.warn("Login shell PATH lookup timed out");
  }, LOGIN_SHELL_PATH_TIMEOUT_MS);
};

// App bootstrap
app.whenReady().then(async () => {
  if (process.platform === "darwin") {
    const iconPath = app.isPackaged
      ? join(process.resourcesPath, "emdash.icns")
      : join(
          __dirname,
          "..",
          "..",
          "src",
          "assets",
          "images",
          "emdash",
          "emdash.icns",
        );

    let dockIcon: Electron.NativeImage | undefined;

    if (existsSync(iconPath)) {
      dockIcon = nativeImage.createFromPath(iconPath);

      if (dockIcon.isEmpty()) {
        try {
          dockIcon = nativeImage.createFromBuffer(readFileSync(iconPath));
        } catch {
          dockIcon = undefined;
        }
      }
    }

    if (!dockIcon || dockIcon.isEmpty()) {
      const fallbackIconPath = join(
        __dirname,
        "..",
        "..",
        "src",
        "assets",
        "images",
        "emdash",
        "emdash_dev.png",
      );
      if (existsSync(fallbackIconPath)) {
        const fallbackIcon = nativeImage.createFromPath(fallbackIconPath);
        if (!fallbackIcon.isEmpty()) {
          dockIcon = fallbackIcon;
        }
      }
    }

    if (dockIcon && !dockIcon.isEmpty()) {
      app.dock.setIcon(dockIcon);
    }
  }

  // Initialize database
  try {
    await databaseService.initialize();
    console.log("Database initialized successfully");
  } catch (error) {
    console.error("Failed to initialize database:", error);
  }

  // Register IPC handlers
  registerAllIpc();

  // Create main window
  createMainWindow();

  // Async PATH refresh to avoid blocking the UI thread.
  setImmediate(refreshPathFromLoginShell);
});

// App lifecycle handlers
registerAppLifecycle();
