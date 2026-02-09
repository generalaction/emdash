import { createHash } from 'crypto';
import { readFile, writeFile, appendFile, access } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import { HostKeyInfo } from '../../../shared/ssh/types';
import { HostKeyEntry } from './types';

const KNOWN_HOSTS_PATH = join(homedir(), '.ssh', 'known_hosts');

/**
 * Service for managing SSH host key verification.
 * Stores and validates host fingerprints for security.
 */
export class SshHostKeyService {
  private knownHosts: Map<string, string> = new Map();
  private initialized = false;

  /**
   * Initialize by loading known_hosts file
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      await access(KNOWN_HOSTS_PATH);
      const content = await readFile(KNOWN_HOSTS_PATH, 'utf-8');
      this.parseKnownHosts(content);
      this.initialized = true;
    } catch (err) {
      // File doesn't exist or can't be read, start with empty
      this.initialized = true;
    }
  }

  /**
   * Parse known_hosts content into memory
   */
  private parseKnownHosts(content: string): void {
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const parts = trimmed.split(' ');
      if (parts.length >= 3) {
        const host = parts[0];
        const key = parts.slice(2).join(' ');
        this.knownHosts.set(host, key);
      }
    }
  }

  /**
   * Get fingerprint for a host key
   */
  getFingerprint(key: Buffer): string {
    const hash = createHash('sha256').update(key).digest('base64');
    return `SHA256:${hash}`;
  }

  /**
   * Verifies a host's key against known hosts.
   * @param host - Hostname or IP address
   * @param port - SSH port
   * @param keyType - Type of host key (e.g., 'rsa', 'ed25519')
   * @param fingerprint - Host key fingerprint
   * @returns Verification result: 'known', 'new', or 'changed'
   */
  async verifyHostKey(
    host: string,
    port: number,
    keyType: string,
    fingerprint: string
  ): Promise<'known' | 'new' | 'changed'> {
    await this.initialize();

    const hostPort = port === 22 ? host : `[${host}]:${port}`;
    const knownKey = this.knownHosts.get(hostPort) || this.knownHosts.get(host);

    if (!knownKey) {
      return 'new';
    }

    // Compare fingerprints instead of raw keys for this interface
    const knownFingerprint = this.getFingerprint(Buffer.from(knownKey, 'base64'));
    if (knownFingerprint === fingerprint) {
      return 'known';
    }

    return 'changed';
  }

  /**
   * Check if host key is known with direct key buffer comparison.
   * Returns 'valid' | 'invalid' | 'unknown'.
   */
  async verifyHostKeyBuffer(
    host: string,
    port: number,
    key: Buffer
  ): Promise<'valid' | 'invalid' | 'unknown'> {
    await this.initialize();

    const hostPort = port === 22 ? host : `[${host}]:${port}`;
    const knownKey = this.knownHosts.get(hostPort) || this.knownHosts.get(host);

    if (!knownKey) {
      return 'unknown';
    }

    const keyBase64 = key.toString('base64');
    if (knownKey === keyBase64) {
      return 'valid';
    }

    return 'invalid';
  }

  /**
   * Adds or updates a host key in the known hosts store.
   * @param host - Hostname or IP address
   * @param port - SSH port
   * @param keyType - Type of host key
   * @param fingerprint - Host key fingerprint
   */
  async addHostKey(
    host: string,
    port: number,
    keyType: string,
    fingerprint: string
  ): Promise<void> {
    await this.initialize();

    const hostPort = port === 22 ? host : `[${host}]:${port}`;
    // Store fingerprint directly for this interface
    this.knownHosts.set(hostPort, fingerprint);

    // Rewrite entire file to ensure consistency
    await this.persistKnownHosts();
  }

  /**
   * Add a host to known_hosts with raw key buffer.
   * @param host - Hostname or IP address
   * @param port - SSH port
   * @param key - Raw host key buffer
   * @param algorithm - Key algorithm (default: 'ssh-ed25519')
   */
  async addKnownHost(
    host: string,
    port: number,
    key: Buffer,
    algorithm: string = 'ssh-ed25519'
  ): Promise<void> {
    await this.initialize();

    const hostPort = port === 22 ? host : `[${host}]:${port}`;
    const keyBase64 = key.toString('base64');
    const entry = `${hostPort} ${algorithm} ${keyBase64}\n`;

    this.knownHosts.set(hostPort, keyBase64);

    try {
      await appendFile(KNOWN_HOSTS_PATH, entry);
    } catch (err) {
      throw new Error(`Failed to write to known_hosts: ${err}`);
    }
  }

  /**
   * Removes a host from the known hosts store.
   * @param host - Hostname or IP address
   * @param port - SSH port
   */
  async removeHostKey(host: string, port: number): Promise<void> {
    await this.initialize();

    const hostPort = port === 22 ? host : `[${host}]:${port}`;
    this.knownHosts.delete(hostPort);
    this.knownHosts.delete(host);

    await this.persistKnownHosts();
  }

  /**
   * Remove a host from known_hosts (alias for removeHostKey).
   * @param host - Hostname or IP address
   * @param port - SSH port
   */
  async removeKnownHost(host: string, port: number): Promise<void> {
    return this.removeHostKey(host, port);
  }

  /**
   * Gets all known hosts.
   * @returns Array of host key entries
   */
  async getKnownHosts(): Promise<HostKeyEntry[]> {
    await this.initialize();

    const entries: HostKeyEntry[] = [];
    for (const [hostPort, keyBase64] of this.knownHosts) {
      // Parse host and port from the key format
      let host: string;
      let port: number;

      if (hostPort.startsWith('[') && hostPort.includes(']:')) {
        const match = hostPort.match(/^\[(.*)\]:(\d+)$/);
        if (match) {
          host = match[1];
          port = parseInt(match[2], 10);
        } else {
          host = hostPort;
          port = 22;
        }
      } else {
        host = hostPort;
        port = 22;
      }

      entries.push({
        host,
        port,
        keyType: 'unknown', // We don't store the algorithm separately in the simple format
        fingerprint: this.getFingerprint(Buffer.from(keyBase64, 'base64')),
        verifiedAt: new Date(),
      });
    }

    return entries;
  }

  /**
   * Checks if a host is known.
   * @param host - Hostname or IP address
   * @param port - SSH port
   * @returns True if host is known
   */
  async isHostKnown(host: string, port: number): Promise<boolean> {
    await this.initialize();

    const hostPort = port === 22 ? host : `[${host}]:${port}`;
    return this.knownHosts.has(hostPort) || this.knownHosts.has(host);
  }

  /**
   * Get host key info for display
   * @param host - Hostname or IP address
   * @param port - SSH port
   * @param key - Raw host key buffer
   * @param algorithm - Key algorithm
   * @returns HostKeyInfo object
   */
  getHostKeyInfo(host: string, port: number, key: Buffer, algorithm: string): HostKeyInfo {
    return {
      host,
      port,
      fingerprint: this.getFingerprint(key),
      algorithm,
      key,
    };
  }

  /**
   * Persist known hosts to the known_hosts file.
   */
  private async persistKnownHosts(): Promise<void> {
    const entries: string[] = [];
    for (const [hostPort, key] of this.knownHosts) {
      // Use ssh-ed25519 as default algorithm since we store fingerprints
      // In a full implementation, we might want to store the algorithm separately
      entries.push(`${hostPort} ssh-ed25519 ${key}`);
    }

    try {
      await writeFile(KNOWN_HOSTS_PATH, entries.join('\n') + (entries.length > 0 ? '\n' : ''));
    } catch (err) {
      throw new Error(`Failed to write to known_hosts: ${err}`);
    }
  }
}
