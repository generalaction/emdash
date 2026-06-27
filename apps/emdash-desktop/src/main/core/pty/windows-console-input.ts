import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { log } from '@main/lib/logger';

const SGR_MOUSE_SEQUENCE = /\x1b\[<\d+;\d+;\d+[Mm]/g;

const POWERSHELL_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class EmdashConsoleInput {
  private const ushort KEY_EVENT = 0x0001;
  private const uint GENERIC_READ = 0x80000000;
  private const uint GENERIC_WRITE = 0x40000000;
  private const uint FILE_SHARE_READ = 0x00000001;
  private const uint FILE_SHARE_WRITE = 0x00000002;
  private const uint OPEN_EXISTING = 3;

  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern bool FreeConsole();

  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern bool AttachConsole(uint dwProcessId);

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern IntPtr CreateFile(
    string lpFileName,
    uint dwDesiredAccess,
    uint dwShareMode,
    IntPtr lpSecurityAttributes,
    uint dwCreationDisposition,
    uint dwFlagsAndAttributes,
    IntPtr hTemplateFile
  );

  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern bool WriteConsoleInput(
    IntPtr hConsoleInput,
    INPUT_RECORD[] lpBuffer,
    uint nLength,
    out uint lpNumberOfEventsWritten
  );

  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern bool CloseHandle(IntPtr hObject);

  [StructLayout(LayoutKind.Explicit)]
  private struct INPUT_RECORD {
    [FieldOffset(0)] public ushort EventType;
    [FieldOffset(4)] public KEY_EVENT_RECORD KeyEvent;
  }

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  private struct KEY_EVENT_RECORD {
    [MarshalAs(UnmanagedType.Bool)] public bool bKeyDown;
    public ushort wRepeatCount;
    public ushort wVirtualKeyCode;
    public ushort wVirtualScanCode;
    public char UnicodeChar;
    public uint dwControlKeyState;
  }

  public static void WriteText(uint pid, string text) {
    FreeConsole();
    if (!AttachConsole(pid)) {
      throw new InvalidOperationException("AttachConsole failed: " + Marshal.GetLastWin32Error());
    }

    IntPtr input = CreateFile(
      "CONIN$",
      GENERIC_READ | GENERIC_WRITE,
      FILE_SHARE_READ | FILE_SHARE_WRITE,
      IntPtr.Zero,
      OPEN_EXISTING,
      0,
      IntPtr.Zero
    );
    if (input == new IntPtr(-1)) {
      throw new InvalidOperationException("CreateFile(CONIN$) failed: " + Marshal.GetLastWin32Error());
    }

    try {
      INPUT_RECORD[] records = new INPUT_RECORD[text.Length];
      for (int i = 0; i < text.Length; i++) {
        records[i].EventType = KEY_EVENT;
        records[i].KeyEvent.bKeyDown = true;
        records[i].KeyEvent.wRepeatCount = 1;
        records[i].KeyEvent.UnicodeChar = text[i];
      }

      uint written;
      if (!WriteConsoleInput(input, records, (uint)records.Length, out written) || written != records.Length) {
        throw new InvalidOperationException("WriteConsoleInput failed: " + Marshal.GetLastWin32Error());
      }
    } finally {
      CloseHandle(input);
      FreeConsole();
    }
  }
}
'@

$inputReader = [Console]::In
while (($line = $inputReader.ReadLine()) -ne $null) {
  $id = $null
  try {
    $message = $line | ConvertFrom-Json
    $id = $message.id
    $text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($message.text))
    [EmdashConsoleInput]::WriteText([uint32]$message.pid, $text)
    [Console]::Out.WriteLine((@{ id = $id; ok = $true } | ConvertTo-Json -Compress))
  } catch {
    if ($id -ne $null) {
      [Console]::Out.WriteLine((@{ id = $id; ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress))
    } else {
      [Console]::Error.WriteLine($_.Exception.Message)
    }
  }
}
`;

export interface WindowsConsoleInputInjector {
  injectText(pid: number, text: string): Promise<boolean>;
}

type PendingInjection = {
  timeout: NodeJS.Timeout;
  resolve: (success: boolean) => void;
};

type InjectionAck = {
  id?: unknown;
  ok?: unknown;
  error?: unknown;
};

const INJECTION_TIMEOUT_MS = 1000;

class PowerShellWindowsConsoleInputInjector implements WindowsConsoleInputInjector {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private failed = false;
  private nextId = 1;
  private stdoutBuffer = '';
  private readonly pending = new Map<number, PendingInjection>();

  injectText(pid: number, text: string): Promise<boolean> {
    if (process.platform !== 'win32') return Promise.resolve(true);
    if (this.failed) return Promise.resolve(false);
    if (!Number.isInteger(pid) || pid <= 0) return Promise.resolve(false);
    if (text.length === 0) return Promise.resolve(true);

    const proc = this.ensureProcess();
    if (!proc || proc.stdin.destroyed) return Promise.resolve(false);

    const id = this.nextId++;

    const payload = JSON.stringify({
      id,
      pid,
      text: Buffer.from(text, 'utf8').toString('base64'),
    });

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        log.warn('WindowsConsoleInputInjector: helper response timed out', { id });
        resolve(false);
      }, INJECTION_TIMEOUT_MS);
      this.pending.set(id, { timeout, resolve });

      proc.stdin.write(`${payload}\n`, (error) => {
        if (!error) return;
        this.resolvePending(id, false);
        log.warn('WindowsConsoleInputInjector: write failed', { error: error.message });
      });
    });
  }

  private ensureProcess(): ChildProcessWithoutNullStreams | null {
    if (this.proc && !this.proc.killed) return this.proc;

    const encodedCommand = Buffer.from(POWERSHELL_SCRIPT, 'utf16le').toString('base64');
    try {
      const proc = spawn(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-EncodedCommand',
          encodedCommand,
        ],
        { windowsHide: true }
      );
      this.proc = proc;

      proc.stdout.on('data', (chunk: Buffer) => {
        this.handleStdout(chunk.toString('utf8'));
      });
      proc.stderr.on('data', (chunk: Buffer) => {
        log.warn('WindowsConsoleInputInjector: helper stderr', { message: chunk.toString('utf8') });
      });
      proc.on('error', (error) => {
        this.failed = true;
        this.resolveAllPending(false);
        log.warn('WindowsConsoleInputInjector: helper failed', { error: error.message });
      });
      proc.on('exit', (code, signal) => {
        if (this.proc === proc) this.proc = null;
        this.resolveAllPending(false);
        if (code !== 0 && code !== null) {
          log.warn('WindowsConsoleInputInjector: helper exited', { code, signal });
        }
      });

      return proc;
    } catch (error) {
      this.failed = true;
      log.warn('WindowsConsoleInputInjector: helper spawn failed', { error: String(error) });
      return null;
    }
  }

  private handleStdout(data: string): void {
    this.stdoutBuffer += data;
    while (true) {
      const newlineIndex = this.stdoutBuffer.indexOf('\n');
      if (newlineIndex === -1) return;

      const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      if (!line) continue;
      this.handleAckLine(line);
    }
  }

  private handleAckLine(line: string): void {
    try {
      const ack = JSON.parse(line) as InjectionAck;
      if (typeof ack.id !== 'number') return;
      const ok = ack.ok === true;
      if (!ok) {
        log.warn('WindowsConsoleInputInjector: injection failed', { id: ack.id, error: ack.error });
      }
      this.resolvePending(ack.id, ok);
    } catch (error) {
      log.warn('WindowsConsoleInputInjector: invalid helper response', {
        line,
        error: String(error),
      });
    }
  }

  private resolvePending(id: number, success: boolean): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timeout);
    pending.resolve(success);
  }

  private resolveAllPending(success: boolean): void {
    for (const id of Array.from(this.pending.keys())) {
      this.resolvePending(id, success);
    }
  }
}

export const windowsConsoleInputInjector = new PowerShellWindowsConsoleInputInjector();

export function extractSgrMouseSequences(data: string | Buffer): string {
  const text = Buffer.isBuffer(data) ? data.toString('latin1') : data;
  return Array.from(text.matchAll(SGR_MOUSE_SEQUENCE), (match) => match[0]).join('');
}

export function stripSgrMouseSequences(data: string | Buffer): string | Buffer {
  const text = Buffer.isBuffer(data) ? data.toString('latin1') : data;
  const stripped = text.replace(SGR_MOUSE_SEQUENCE, '');
  return Buffer.isBuffer(data) ? Buffer.from(stripped, 'latin1') : stripped;
}
