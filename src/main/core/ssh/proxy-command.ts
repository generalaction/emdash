import { spawn } from 'node:child_process';
import { Duplex } from 'node:stream';

export function normalizeProxyCommand(proxyCommand?: string | null): string | undefined {
  const value = proxyCommand?.trim();
  if (!value || value.toLowerCase() === 'none') {
    return undefined;
  }
  return value;
}

export function interpolateProxyCommand(
  value: string,
  options: {
    host: string;
    port: number;
    username: string;
  }
): string {
  return value.replace(/%%|%h|%p|%r/g, (token) => {
    switch (token) {
      case '%%':
        return '%';
      case '%h':
        return options.host;
      case '%p':
        return String(options.port);
      case '%r':
        return options.username;
      default:
        return token;
    }
  });
}

function parseProxyCommandArgs(proxyCommand: string): string[] {
  const args: string[] = [];
  let current = '';
  let quote: "'" | '"' | null = null;
  let escaping = false;

  for (let index = 0; index < proxyCommand.length; index += 1) {
    const char = proxyCommand[index];

    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }

    if (char === '\\') {
      escaping = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (escaping) {
    current += '\\';
  }

  if (quote) {
    throw new Error(`ProxyCommand contains an unmatched ${quote} quote`);
  }

  if (current) {
    args.push(current);
  }

  if (args.length === 0) {
    throw new Error('ProxyCommand is empty');
  }

  return args;
}

export interface ProxyCommandTransport {
  sock: Duplex;
  cleanup(): void;
}

export function createProxyCommandTransport(
  proxyCommand: string,
  options: {
    host: string;
    port: number;
    username: string;
    onDebug?: (line: string) => void;
  }
): ProxyCommandTransport {
  const [command, ...args] = parseProxyCommandArgs(proxyCommand).map((arg) =>
    interpolateProxyCommand(arg, options)
  );
  const child = spawn(command, args, {
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const sock = Duplex.from({
    readable: child.stdout,
    writable: child.stdin,
  });

  let closedByOwner = false;
  let cleanedUp = false;

  const cleanup = (): void => {
    if (cleanedUp) return;
    cleanedUp = true;
    closedByOwner = true;
    sock.destroy();
    child.stdin.destroy();
    child.stdout.destroy();
    child.stderr.destroy();
    if (!child.killed) {
      child.kill();
    }
  };

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    const lines = chunk
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    for (const line of lines) {
      options.onDebug?.(`[ProxyCommand] ${line}`);
    }
  });

  child.once('error', (error) => {
    if (closedByOwner) return;
    sock.destroy(error);
  });

  child.once('close', (code, signal) => {
    if (closedByOwner) return;
    const reason =
      signal != null
        ? `ProxyCommand exited with signal ${signal}`
        : `ProxyCommand exited with code ${code ?? 'unknown'}`;
    sock.destroy(new Error(reason));
  });

  return { sock, cleanup };
}
