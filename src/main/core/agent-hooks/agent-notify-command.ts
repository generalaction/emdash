import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, win32 } from 'node:path';
import { log } from '@main/lib/logger';

export type CodexNotifyCommandOptions = {
  platform?: NodeJS.Platform;
  writeFile?: (path: string, content: string) => void;
  mkdir?: (path: string) => void;
  scriptPath?: string;
};

const ensuredWindowsCodexNotifyScriptPaths = new Set<string>();

export function makeClaudeHookCommand(eventType: string): string {
  return (
    'curl -sf -X POST ' +
    '-H "Content-Type: application/json" ' +
    '-H "X-Emdash-Token: $EMDASH_HOOK_TOKEN" ' +
    '-H "X-Emdash-Pty-Id: $EMDASH_PTY_ID" ' +
    `-H "X-Emdash-Event-Type: ${eventType}" ` +
    '-d @- ' +
    '"http://127.0.0.1:$EMDASH_HOOK_PORT/hook" || true'
  );
}

function makePosixCodexNotifyCommand(): string[] {
  return [
    'bash',
    '-c',
    'curl -sf -X POST ' +
      "-H 'Content-Type: application/json' " +
      '-H "X-Emdash-Token: $EMDASH_HOOK_TOKEN" ' +
      '-H "X-Emdash-Pty-Id: $EMDASH_PTY_ID" ' +
      '-H "X-Emdash-Event-Type: notification" ' +
      '-d "$1" ' +
      '"http://127.0.0.1:$EMDASH_HOOK_PORT/hook" || true',
    '_',
  ];
}

function windowsCodexNotifyScript(): string {
  return [
    'param([string]$payload)',
    'try {',
    '  Invoke-WebRequest -UseBasicParsing -Method POST ' +
      "-Uri ('http://127.0.0.1:' + $env:EMDASH_HOOK_PORT + '/hook') " +
      '-Headers @{ ' +
      "'Content-Type' = 'application/json'; " +
      "'X-Emdash-Token' = $env:EMDASH_HOOK_TOKEN; " +
      "'X-Emdash-Pty-Id' = $env:EMDASH_PTY_ID; " +
      "'X-Emdash-Event-Type' = 'notification' " +
      '} -Body $payload | Out-Null',
    '} catch {',
    '  exit 0',
    '}',
    '',
  ].join('\n');
}

function ensureWindowsCodexNotifyScript(options: CodexNotifyCommandOptions): string {
  const platform = options.platform ?? process.platform;
  const scriptPath = options.scriptPath ?? join(tmpdir(), 'emdash-codex-notify.ps1');
  if (ensuredWindowsCodexNotifyScriptPaths.has(scriptPath)) {
    return scriptPath;
  }

  const scriptDir = platform === 'win32' ? win32.dirname(scriptPath) : dirname(scriptPath);
  const mkdir = options.mkdir ?? ((path: string) => mkdirSync(path, { recursive: true }));
  const writeFile = options.writeFile ?? writeFileSync;

  try {
    mkdir(scriptDir);
    writeFile(scriptPath, windowsCodexNotifyScript());
    ensuredWindowsCodexNotifyScriptPaths.add(scriptPath);
  } catch (err) {
    log.warn('CodexNotifyCommand: failed to write Windows notify script', {
      path: scriptPath,
      error: String(err),
    });
  }

  return scriptPath;
}

function makeWindowsCodexNotifyCommand(options: CodexNotifyCommandOptions): string[] {
  return ['powershell.exe', '-NoProfile', '-File', ensureWindowsCodexNotifyScript(options)];
}

export function makeCodexNotifyCommand(options: CodexNotifyCommandOptions = {}): string[] {
  const platform = options.platform ?? process.platform;
  return platform === 'win32'
    ? makeWindowsCodexNotifyCommand(options)
    : makePosixCodexNotifyCommand();
}
