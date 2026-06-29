import { describe, expect, it } from 'vitest';
import { buildStandardCommand, wrapWithStdinPipe } from './standard-command';

describe('buildStandardCommand', () => {
  it('keeps stdin-piped prompts on the existing bash wrapper for POSIX platforms', () => {
    const result = wrapWithStdinPipe(
      {
        command: '/usr/local/bin/amp',
        args: ['--dangerously-allow-all', "it's ok"],
        env: { PLUGINS: 'all' },
      },
      'Fix the bug',
      'darwin'
    );

    expect(result).toEqual({
      command: 'bash',
      args: [
        '-c',
        "printf '%s\n' 'Fix the bug' | /usr/local/bin/amp --dangerously-allow-all 'it'\\''s ok'",
      ],
      env: { PLUGINS: 'all' },
    });
  });

  it('wraps stdin-piped prompts with byte-preserving stdin redirection on Windows', () => {
    const result = wrapWithStdinPipe(
      {
        command: 'C:\\Users\\me\\AppData\\Roaming\\npm\\amp.CMD',
        args: ['--dangerously-allow-all', "it's ok"],
        env: { PLUGINS: 'all' },
      },
      'Fix the bug',
      'win32'
    );

    expect(result.command).toBe('powershell.exe');
    expect(result.env).toEqual({ PLUGINS: 'all' });
    expect(result.args.slice(0, 3)).toEqual(['-NoProfile', '-ExecutionPolicy', 'Bypass']);
    expect(result.args[3]).toBe('-EncodedCommand');

    const script = Buffer.from(result.args[4]!, 'base64').toString('utf16le');
    expect(script).toContain('$OutputEncoding = [Text.UTF8Encoding]::new($false)');
    expect(script).toContain(
      "[IO.File]::WriteAllBytes($promptPath, [Convert]::FromBase64String('Rml4IHRoZSBidWcK'))"
    );
    expect(script).toContain(
      `$cmdTail = '"' + "$agentLine < $(Quote-CmdArg $promptPath)" + '"'`
    );
    expect(script).toContain('& $env:ComSpec /d /s /c $cmdTail');
    expect(script).toContain('< $(Quote-CmdArg $promptPath)');
    expect(script).toContain("'LS1kYW5nZXJvdXNseS1hbGxvdy1hbGw=', 'aXQncyBvaw=='");
    expect(script).not.toContain('$prompt |');
    expect(script).toContain('exit $LASTEXITCODE');
  });

  it('normalizes extensionless Windows npm shims to cmd files before invoking them', () => {
    const result = wrapWithStdinPipe(
      {
        command: 'C:\\Users\\me\\AppData\\Roaming\\npm\\amp',
        args: [],
        env: {},
      },
      'Fix the bug',
      'win32'
    );

    const script = Buffer.from(result.args[4]!, 'base64').toString('utf16le');
    expect(script).toContain('if (-not [IO.Path]::HasExtension($command))');
    expect(script).toContain("$cmdShim = $command + '.cmd'");
    expect(script).toContain(
      'if (Test-Path -LiteralPath $cmdShim -PathType Leaf) { $command = $cmdShim }'
    );
    expect(script).toContain('$agentLine = @((Quote-CmdArg $command)');
    expect(script).not.toContain("'C:\\Users\\me\\AppData\\Roaming\\npm\\amp'");
  });

  it('splits multi-word resume fallback flags into argv parts', () => {
    const result = buildStandardCommand(
      {
        cli: 'codex',
        autoApprove: false,
        sessionId: 'conversation-1',
        isResuming: true,
        model: '',
      },
      {
        resumeFlag: 'resume',
        sessionIdFlag: ' ',
        sessionIdOnResumeOnly: true,
        resumeWithoutSessionFlag: 'resume --last',
      }
    );

    expect(result.args).toEqual(['resume', '--last']);
  });

  it('splits multi-word resume flags before appending the session id', () => {
    const result = buildStandardCommand(
      {
        cli: 'amp',
        autoApprove: false,
        providerSessionId: 'T-thread-1',
        sessionId: 'conversation-1',
        isResuming: true,
        model: '',
      },
      {
        resumeFlag: 'threads continue',
        sessionIdFlag: 'threads continue',
        sessionIdOnResumeOnly: true,
      }
    );

    expect(result.args).toEqual(['threads', 'continue', 'T-thread-1']);
  });

  it('injects modelFlag when ctx.model is non-empty', () => {
    const result = buildStandardCommand(
      {
        cli: 'claude',
        autoApprove: false,
        sessionId: 'conv-1',
        isResuming: false,
        model: 'sonnet',
      },
      {
        modelFlag: '--model',
        initialPromptFlag: '',
      }
    );

    expect(result.args).toContain('--model');
    expect(result.args).toContain('sonnet');
    const modelIdx = result.args.indexOf('--model');
    expect(result.args[modelIdx + 1]).toBe('sonnet');
  });

  it('does not inject modelFlag when ctx.model is empty', () => {
    const result = buildStandardCommand(
      {
        cli: 'claude',
        autoApprove: false,
        sessionId: 'conv-1',
        isResuming: false,
        model: '',
      },
      {
        modelFlag: '--model',
        initialPromptFlag: '',
      }
    );

    expect(result.args).not.toContain('--model');
  });

  it('injects short modelFlag (-m) for codex style', () => {
    const result = buildStandardCommand(
      {
        cli: 'codex',
        autoApprove: false,
        sessionId: 'conv-1',
        isResuming: false,
        model: 'gpt-5-codex',
      },
      {
        modelFlag: '-m',
        initialPromptFlag: '',
      }
    );

    const mIdx = result.args.indexOf('-m');
    expect(mIdx).toBeGreaterThanOrEqual(0);
    expect(result.args[mIdx + 1]).toBe('gpt-5-codex');
  });
});
