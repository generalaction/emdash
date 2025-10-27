import net from 'node:net';

import type { ResolvedContainerPortConfig } from './config';
import type { RunnerPortMapping } from './events';

const DEFAULT_MIN_PORT = 49152; // IANA dynamic/private range start
const DEFAULT_MAX_PORT = 65535;
const DEFAULT_MAX_ATTEMPTS = 128;

export interface PortManagerOptions {
  minPort?: number;
  maxPort?: number;
  maxAttemptsPerPort?: number;
  host?: string;
}

export interface AllocatePortsOptions {}

export class PortAllocationError extends Error {
  readonly code = 'PORT_ALLOC_FAILED' as const;

  constructor(message: string) {
    super(message);
    this.name = 'PortAllocationError';
  }
}

export class PortManager {
  private readonly minPort: number;
  private readonly maxPort: number;
  private readonly maxAttemptsPerPort: number;
  private readonly host: string;
  private readonly reserved = new Set<number>();

  constructor(options: PortManagerOptions = {}) {
    const min = options.minPort ?? DEFAULT_MIN_PORT;
    const max = options.maxPort ?? DEFAULT_MAX_PORT;
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max > 65535 || min > max) {
      throw new PortAllocationError('Invalid port range supplied to PortManager');
    }
    this.minPort = min;
    this.maxPort = max;
    this.maxAttemptsPerPort = options.maxAttemptsPerPort ?? DEFAULT_MAX_ATTEMPTS;
    this.host = options.host ?? '127.0.0.1';
  }

  reserveHostPort(port: number): void {
    if (!Number.isInteger(port)) return;
    this.reserved.add(port);
  }

  reserveHostPorts(ports: Iterable<number>): void {
    for (const port of ports) this.reserveHostPort(port);
  }

  releaseHostPort(port: number): void {
    this.reserved.delete(port);
  }

  releaseHostPorts(ports: Iterable<number>): void {
    for (const port of ports) this.releaseHostPort(port);
  }

  reset(): void {
    this.reserved.clear();
  }

  async allocate(
    requests: ResolvedContainerPortConfig[],
    _options: AllocatePortsOptions = {}
  ): Promise<RunnerPortMapping[]> {
    if (!Array.isArray(requests) || requests.length === 0) return [];

    const allocations: RunnerPortMapping[] = [];
    const newlyReserved: number[] = [];

    try {
      for (const request of requests) {
        const hostPort = await this.findAvailablePort();
        this.reserved.add(hostPort);
        newlyReserved.push(hostPort);

        allocations.push({
          service: request.service,
          protocol: request.protocol,
          container: request.container,
          host: hostPort,
        });
      }
      return allocations;
    } catch (error) {
      // Roll back any new reservations from this allocation attempt
      newlyReserved.forEach((port) => this.reserved.delete(port));
      throw error;
    }
  }

  private async findAvailablePort(): Promise<number> {
    const attempted = new Set<number>();

    for (let attempt = 0; attempt < this.maxAttemptsPerPort; attempt += 1) {
      const candidate = this.randomPort();
      if (attempted.has(candidate)) {
        continue;
      }
      attempted.add(candidate);

      if (this.reserved.has(candidate)) {
        continue;
      }

      const free = await this.checkPortAvailability(candidate);
      if (free) {
        return candidate;
      }
    }

    throw new PortAllocationError('Unable to allocate a free host port');
  }

  private randomPort(): number {
    const range = this.maxPort - this.minPort + 1;
    return this.minPort + Math.floor(Math.random() * range);
  }

  private checkPortAvailability(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer();

      const finalize = (available: boolean) => {
        if (server.listening) {
          server.close(() => resolve(available));
        } else {
          resolve(available);
        }
      };

      server.once('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE' || error.code === 'EACCES') {
          finalize(false);
          return;
        }
        finalize(false);
      });

      server.listen(port, this.host, () => {
        finalize(true);
      });
    });
  }
}
