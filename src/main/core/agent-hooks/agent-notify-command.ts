import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, win32 } from 'node:path';
import { log } from '@main/lib/logger';
import openCodePluginContent from './opencode-notifications-plugin.js?raw';

export type CodexNotifyCommandOptions = {
  platform?: NodeJS.Platform;
  writeFile?: (path: string, content: string) => void;
  mkdir?: (path: string) => void;
  scriptPath?: string;
};

export type ClaudeHookCommandOptions = {
  platform?: NodeJS.Platform;
  writeFile?: (path: string, content: string) => void;
  mkdir?: (path: string) => void;
  scriptPath?: string;
};

const ensuredWindowsCodexNotifyScriptPaths = new Set<string>();
const ensuredWindowsClaudeHookScriptPaths = new Set<string>();

function makePosixClaudeHookCommand(eventType: string): string {
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

/**
 * PowerShell script invoked as Claude's hook on Windows. Claude pipes the JSON
 * payload over stdin; we read it, POST it to the local hook endpoint, and
 * always exit 0 so a transient HTTP failure doesn't surface as a hook error
 * inside Claude.
 */
function windowsClaudeHookScript(): string {
  return [
    'param([string]$eventType)',
    '$payload = [System.Console]::In.ReadToEnd()',
    'try {',
    '  Invoke-WebRequest -UseBasicParsing -Method POST ' +
      "-Uri ('http://127.0.0.1:' + $env:EMDASH_HOOK_PORT + '/hook') " +
      '-Headers @{ ' +
      "'Content-Type' = 'application/json'; " +
      "'X-Emdash-Token' = $env:EMDASH_HOOK_TOKEN; " +
      "'X-Emdash-Pty-Id' = $env:EMDASH_PTY_ID; " +
      "'X-Emdash-Event-Type' = $eventType " +
      '} -Body $payload | Out-Null',
    '} catch {',
    '  exit 0',
    '}',
    '',
  ].join('\n');
}

function ensureWindowsClaudeHookScript(options: ClaudeHookCommandOptions): string {
  const platform = options.platform ?? process.platform;
  const scriptPath = options.scriptPath ?? join(tmpdir(), 'emdash-claude-hook.ps1');
  if (ensuredWindowsClaudeHookScriptPaths.has(scriptPath)) {
    return scriptPath;
  }

  const scriptDir = platform === 'win32' ? win32.dirname(scriptPath) : dirname(scriptPath);
  const mkdir = options.mkdir ?? ((path: string) => mkdirSync(path, { recursive: true }));
  const writeFile = options.writeFile ?? writeFileSync;

  try {
    mkdir(scriptDir);
    writeFile(scriptPath, windowsClaudeHookScript());
    ensuredWindowsClaudeHookScriptPaths.add(scriptPath);
  } catch (err) {
    log.warn('ClaudeHookCommand: failed to write Windows hook script', {
      path: scriptPath,
      error: String(err),
    });
  }

  return scriptPath;
}

function makeWindowsClaudeHookCommand(
  eventType: string,
  options: ClaudeHookCommandOptions
): string {
  const scriptPath = ensureWindowsClaudeHookScript(options);
  // Claude on Windows runs hook commands via cmd.exe; the powershell.exe
  // invocation needs the script path quoted so paths containing spaces
  // (e.g. inside %TEMP% under "Documents and Settings") still resolve.
  return `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}" ${eventType}`;
}

export function makeClaudeHookCommand(
  eventType: string,
  options: ClaudeHookCommandOptions = {}
): string {
  const platform = options.platform ?? process.platform;
  return platform === 'win32'
    ? makeWindowsClaudeHookCommand(eventType, options)
    : makePosixClaudeHookCommand(eventType);
}

export function makeOpenCodePluginContent(): string {
  return openCodePluginContent;
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
