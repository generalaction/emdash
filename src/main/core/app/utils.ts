import { exec, execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';
import { buildExternalToolEnv } from '@main/utils/childProcessEnv';

const UNKNOWN_VERSION = 'unknown';

export const execCommand = (
  command: string,
  opts?: { maxBuffer?: number; timeout?: number }
): Promise<string> =>
  new Promise((resolve, reject) => {
    exec(
      command,
      {
        maxBuffer: opts?.maxBuffer ?? 8 * 1024 * 1024,
        timeout: opts?.timeout ?? 30_000,
        env: buildExternalToolEnv(),
      },
      (error, stdout) => {
        if (error) return reject(error);
        resolve(stdout ?? '');
      }
    );
  });

export const execFileCommand = (
  file: string,
  args: string[],
  opts?: { timeout?: number }
): Promise<void> =>
  new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        timeout: opts?.timeout ?? 30_000,
        env: buildExternalToolEnv(),
      },
      (error) => {
        if (error) return reject(error);
        resolve();
      }
    );
  });

export const escapeAppleScriptString = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

// ─── Font discovery ───────────────────────────────────────────────────────────

const dedupeAndSortFonts = (fonts: string[]): string[] => {
  const unique = Array.from(new Set(fonts.map((f) => f.trim()).filter(Boolean)));
  return unique.sort((a, b) => a.localeCompare(b));
};

const listInstalledFontsMac = async (): Promise<string[]> => {
  const stdout = await execCommand('system_profiler SPFontsDataType -json', {
    maxBuffer: 24 * 1024 * 1024,
    timeout: 60_000,
  });
  const parsed = JSON.parse(stdout) as {
    SPFontsDataType?: Array<{
      typefaces?: Array<{ family?: string; fullname?: string }>;
      _name?: string;
    }>;
  };
  const fonts: string[] = [];
  for (const item of parsed.SPFontsDataType ?? []) {
    for (const typeface of item.typefaces ?? []) {
      if (typeface.family) fonts.push(typeface.family);
    }
  }
  return dedupeAndSortFonts(fonts);
};

const listInstalledFontsLinux = async (): Promise<string[]> => {
  const stdout = await execCommand('fc-list : family', { timeout: 30_000 });
  const fonts = stdout
    .split('\n')
    .flatMap((line) => line.split(','))
    .map((font) => font.trim())
    .filter(Boolean);
  return dedupeAndSortFonts(fonts);
};

const listInstalledFontsWindows = async (): Promise<string[]> => {
  const script =
    "$fonts = Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts';" +
    "$props = $fonts.PSObject.Properties | Where-Object { $_.Name -notlike 'PS*' };" +
    "$props | ForEach-Object { ($_.Name -replace '\\s*\\(.*\\)$','').Trim() }";
  const stdout = await execCommand(`powershell -NoProfile -Command "${script}"`, {
    timeout: 30_000,
  });
  return dedupeAndSortFonts(
    stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
  );
};

export const listInstalledFontsAll = async (): Promise<string[]> => {
  switch (process.platform) {
    case 'darwin':
      return listInstalledFontsMac();
    case 'linux':
      return listInstalledFontsLinux();
    case 'win32':
      return listInstalledFontsWindows();
    default:
      return [];
  }
};

// ─── App version ─────────────────────────────────────────────────────────────

const readPackageVersion = async (packageJsonPath: string): Promise<string | null> => {
  try {
    const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf-8'));
    if (packageJson.name === 'emdash' && packageJson.version) {
      return packageJson.version as string;
    }
  } catch {
    // Ignore missing or malformed package.json; try the next path.
  }
  return null;
};

export const resolveAppVersion = async (): Promise<string> => {
  if (import.meta.env.MAIN_VITE_APP_VERSION) {
    return import.meta.env.MAIN_VITE_APP_VERSION;
  }

  try {
    const version = app.getVersion();
    if (version && version !== '0.0.0') return version;
  } catch {
    // fall through
  }

  const possiblePaths = [
    join(__dirname, '../../package.json'),
    join(process.cwd(), 'package.json'),
    join(app.getAppPath(), 'package.json'),
  ];

  for (const packageJsonPath of possiblePaths) {
    const version = await readPackageVersion(packageJsonPath);
    if (version) return version;
  }

  try {
    return app.getVersion();
  } catch {
    return UNKNOWN_VERSION;
  }
};

// ─── Installed-app detection ─────────────────────────────────────────────────

export const checkCommand = (cmd: string): Promise<boolean> =>
  new Promise((resolve) => {
    exec(`command -v ${cmd} >/dev/null 2>&1`, { env: buildExternalToolEnv() }, (error) => {
      resolve(!error);
    });
  });

export const checkMacApp = (bundleId: string): Promise<boolean> =>
  new Promise((resolve) => {
    exec(
      `mdfind "kMDItemCFBundleIdentifier == '${bundleId}'"`,
      { env: buildExternalToolEnv() },
      (error, stdout) => {
        resolve(!error && stdout.trim().length > 0);
      }
    );
  });

export const checkMacAppByName = (appName: string): Promise<boolean> =>
  new Promise((resolve) => {
    exec(
      `osascript -e 'id of application "${appName}"' 2>/dev/null`,
      { env: buildExternalToolEnv() },
      (error) => {
        resolve(!error);
      }
    );
  });
