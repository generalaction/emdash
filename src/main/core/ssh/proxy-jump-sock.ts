import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { Duplex, type Readable, type Writable } from 'node:stream';

type SshChild = ChildProcessByStdio<Writable, Readable, Readable>;

/**
 * Duplex wrapper around a child process's stdin/stdout that behaves like a
 * net.Socket: writes are forwarded atomically (preserving SSH packet framing),
 * reads are pushed in order, and lifecycle is tied to the child process.
 *
 * `Duplex.from({writable, readable})` is unsuitable here because it composes
 * two independent streams without enforcing write ordering or proper
 * backpressure, which corrupts ssh2's transport framing under concurrent
 * channel opens.
 */
class ProcessSocket extends Duplex {
  private readonly child: SshChild;
  private endedReadable = false;

  constructor(child: SshChild) {
    super({ allowHalfOpen: true });
    this.child = child;

    child.stdout.on('data', (chunk: Buffer) => {
      if (!this.push(chunk)) {
        child.stdout.pause();
      }
    });
    child.stdout.once('end', () => this.endReadable());
    child.stdout.once('error', (err) => this.destroy(err));
    child.stdin.on('error', (err) => this.destroy(err));
  }

  private endReadable(): void {
    if (this.endedReadable) return;
    this.endedReadable = true;
    this.push(null);
  }

  override _read(): void {
    this.child.stdout.resume();
  }

  override _write(chunk: Buffer, _enc: BufferEncoding, cb: (err?: Error | null) => void): void {
    this.child.stdin.write(chunk, (err) => cb(err ?? null));
  }

  override _final(cb: (err?: Error | null) => void): void {
    this.child.stdin.end(cb);
  }

  override _destroy(err: Error | null, cb: (err: Error | null) => void): void {
    if (!this.child.killed && this.child.exitCode === null) {
      this.child.kill();
    }
    cb(err);
  }
}

function splitProxyJumpEntry(entry: string): { destination: string; port?: string } {
  const hop = entry.trim();
  const uriMatch = hop.match(/^ssh:\/\/(?:(.+?)@)?(\[[^\]]+\]|[^:/?#]+)(?::(\d+))?$/i);
  if (uriMatch) {
    const user = uriMatch[1];
    const host = uriMatch[2];
    return { destination: user ? `${user}@${host}` : host, port: uriMatch[3] };
  }

  const ipv6Match = hop.match(/^(.*@)?(\[[^\]]+\])(?::(\d+))?$/);
  if (ipv6Match) {
    const user = ipv6Match[1]?.slice(0, -1);
    const host = ipv6Match[2];
    return { destination: user ? `${user}@${host}` : host, port: ipv6Match[3] };
  }

  const atIdx = hop.lastIndexOf('@');
  const hostPort = atIdx >= 0 ? hop.slice(atIdx + 1) : hop;
  const user = atIdx >= 0 ? hop.slice(0, atIdx) : '';
  const colonIdx = hostPort.lastIndexOf(':');

  if (colonIdx > 0) {
    const host = hostPort.slice(0, colonIdx);
    const port = hostPort.slice(colonIdx + 1);
    if (/^\d+$/.test(port)) {
      return { destination: user ? `${user}@${host}` : host, port };
    }
  }

  return { destination: hop };
}

function parseProxyJumpChain(proxyJump: string): {
  intermediates: string[];
  final: { destination: string; port?: string };
} {
  const hops = proxyJump
    .split(',')
    .map((h) => h.trim())
    .filter((h) => h.length > 0);
  const finalHop = hops[hops.length - 1] ?? '';
  return {
    intermediates: hops.slice(0, -1),
    final: splitProxyJumpEntry(finalHop),
  };
}

export function buildProxyJumpSocket(
  targetHost: string,
  targetPort: number,
  proxyJump: string,
  options?: { onStderrLine?: (line: string) => void }
): Duplex {
  const { intermediates, final } = parseProxyJumpChain(proxyJump);
  const args = ['-o', 'BatchMode=yes', '-o', 'ControlMaster=no', '-o', 'ControlPath=none'];
  if (intermediates.length > 0) {
    // Chain through earlier hops with -J; the final hop is the SSH destination
    // and is what -W tunnels stdio through to reach targetHost:targetPort.
    args.push('-J', intermediates.join(','));
  }
  args.push('-W', `${targetHost}:${targetPort}`);
  if (final.port) {
    args.push('-p', final.port);
  }
  args.push(final.destination);

  const child = spawn('ssh', args, { stdio: ['pipe', 'pipe', 'pipe'] }) as SshChild;
  const sock = new ProcessSocket(child);
  let stderrOutput = '';

  child.once('error', (error) => {
    sock.destroy(error);
  });

  child.stderr.setEncoding('utf-8');
  child.stderr.on('data', (chunk: string) => {
    stderrOutput += chunk;
    if (options?.onStderrLine) {
      for (const line of chunk.split('\n')) {
        const trimmed = line.trim();
        if (trimmed) {
          options.onStderrLine(trimmed);
        }
      }
    }
    // Cap retained stderr to prevent unbounded growth if the process is noisy.
    if (stderrOutput.length > 4096) {
      stderrOutput = stderrOutput.slice(-4096);
    }
  });

  child.once('exit', (code, signal) => {
    if (sock.destroyed || code === 0) return;
    const reason = signal
      ? `signal ${signal}`
      : code != null
        ? `exit code ${code}`
        : 'unknown exit';
    const stderr = stderrOutput.trim();
    const detail = stderr ? `: ${stderr}` : '';
    sock.destroy(new Error(`ProxyJump command failed (${reason})${detail}`));
  });

  return sock;
}
