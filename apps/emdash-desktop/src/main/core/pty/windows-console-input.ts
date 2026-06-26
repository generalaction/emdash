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
  try {
    $message = $line | ConvertFrom-Json
    $text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($message.text))
    [EmdashConsoleInput]::WriteText([uint32]$message.pid, $text)
  } catch {
    [Console]::Error.WriteLine($_.Exception.Message)
  }
}
`;

export interface WindowsConsoleInputInjector {
  injectText(pid: number, text: string): void;
}

class PowerShellWindowsConsoleInputInjector implements WindowsConsoleInputInjector {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private failed = false;

  injectText(pid: number, text: string): void {
    if (process.platform !== 'win32') return;
    if (this.failed) return;
    if (!Number.isInteger(pid) || pid <= 0 || text.length === 0) return;

    const proc = this.ensureProcess();
    if (!proc || proc.stdin.destroyed) return;

    const payload = JSON.stringify({
      pid,
      text: Buffer.from(text, 'utf8').toString('base64'),
    });
    proc.stdin.write(`${payload}\n`, (error) => {
      if (error) log.warn('WindowsConsoleInputInjector: write failed', { error: error.message });
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

      proc.stderr.on('data', (chunk: Buffer) => {
        log.warn('WindowsConsoleInputInjector: helper stderr', { message: chunk.toString('utf8') });
      });
      proc.on('error', (error) => {
        this.failed = true;
        log.warn('WindowsConsoleInputInjector: helper failed', { error: error.message });
      });
      proc.on('exit', (code, signal) => {
        if (this.proc === proc) this.proc = null;
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
