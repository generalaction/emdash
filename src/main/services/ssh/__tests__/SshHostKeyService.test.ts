import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import { createHash } from 'crypto';
import { SshHostKeyService } from '../SshHostKeyService';

// Mock fs/promises with hoisting-safe pattern
vi.mock('fs/promises', () => {
  return {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    appendFile: vi.fn(),
    access: vi.fn(),
  };
});

// Mock os
vi.mock('os', () => ({
  homedir: vi.fn().mockReturnValue('/home/testuser'),
}));

// Import after mocking
import { readFile, writeFile, appendFile, access } from 'fs/promises';

describe('SshHostKeyService', () => {
  let service: SshHostKeyService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new SshHostKeyService();
  });

  describe('initialization', () => {
    it('should initialize with empty known_hosts if file does not exist', async () => {
      (access as Mock).mockRejectedValue(new Error('File not found'));

      await service.initialize();
      const hosts = await service.getKnownHosts();

      expect(hosts).toEqual([]);
      expect(access).toHaveBeenCalledWith('/home/testuser/.ssh/known_hosts');
    });

    it('should parse existing known_hosts file', async () => {
      const knownHostsContent = `
# This is a comment
host1.example.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDIhz2GK/XCUj4i6Q5yQJNL1MXMY0RxzPV2QrBqfHrDq
[host2.example.com]:2222 ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQCx

host3.example.com ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBM1
      `;

      (access as Mock).mockResolvedValue(undefined);
      (readFile as Mock).mockResolvedValue(knownHostsContent);

      await service.initialize();
      const hosts = await service.getKnownHosts();

      expect(hosts).toHaveLength(3);
      expect(hosts.some((h) => h.host === 'host1.example.com')).toBe(true);
      expect(hosts.some((h) => h.host === 'host2.example.com' && h.port === 2222)).toBe(true);
    });

    it('should skip re-initialization', async () => {
      (access as Mock).mockRejectedValue(new Error('File not found'));

      await service.initialize();
      await service.initialize();

      expect(access).toHaveBeenCalledTimes(1);
    });
  });

  describe('fingerprint generation', () => {
    it('should generate SHA256 fingerprint', () => {
      const keyBuffer = Buffer.from('test-key-data');
      const fingerprint = service.getFingerprint(keyBuffer);

      const expectedHash = createHash('sha256').update(keyBuffer).digest('base64');
      expect(fingerprint).toBe(`SHA256:${expectedHash}`);
    });

    it('should generate different fingerprints for different keys', () => {
      const key1 = Buffer.from('key-one');
      const key2 = Buffer.from('key-two');

      const fp1 = service.getFingerprint(key1);
      const fp2 = service.getFingerprint(key2);

      expect(fp1).not.toBe(fp2);
    });

    it('should generate consistent fingerprints for same key', () => {
      const key = Buffer.from('test-key');

      const fp1 = service.getFingerprint(key);
      const fp2 = service.getFingerprint(key);

      expect(fp1).toBe(fp2);
    });
  });

  describe('host key verification', () => {
    it('should return new for unknown host', async () => {
      (access as Mock).mockRejectedValue(new Error('File not found'));

      const result = await service.verifyHostKey(
        'unknown.host.com',
        22,
        'ssh-ed25519',
        'SHA256:abc123'
      );

      expect(result).toBe('new');
    });

    it('should return known for matching fingerprint', async () => {
      const keyBuffer = Buffer.from('known-key-data');
      const fingerprint = service.getFingerprint(keyBuffer);
      const keyBase64 = keyBuffer.toString('base64');

      (access as Mock).mockResolvedValue(undefined);
      (readFile as Mock).mockResolvedValue(`known.host.com ssh-ed25519 ${keyBase64}`);

      const result = await service.verifyHostKey('known.host.com', 22, 'ssh-ed25519', fingerprint);

      expect(result).toBe('known');
    });

    it('should return changed for non-matching fingerprint', async () => {
      const keyBuffer = Buffer.from('original-key-data');
      const keyBase64 = keyBuffer.toString('base64');

      (access as Mock).mockResolvedValue(undefined);
      (readFile as Mock).mockResolvedValue(`changed.host.com ssh-ed25519 ${keyBase64}`);

      const result = await service.verifyHostKey(
        'changed.host.com',
        22,
        'ssh-ed25519',
        'SHA256:differentfingerprint'
      );

      expect(result).toBe('changed');
    });

    it('should handle non-standard port format', async () => {
      const keyBuffer = Buffer.from('port-key-data');
      const fingerprint = service.getFingerprint(keyBuffer);
      const keyBase64 = keyBuffer.toString('base64');

      (access as Mock).mockResolvedValue(undefined);
      (readFile as Mock).mockResolvedValue(`[port.host.com]:2222 ssh-ed25519 ${keyBase64}`);

      const result = await service.verifyHostKey('port.host.com', 2222, 'ssh-ed25519', fingerprint);

      expect(result).toBe('known');
    });
  });

  describe('verifyHostKeyBuffer', () => {
    it('should return unknown for unknown host', async () => {
      (access as Mock).mockRejectedValue(new Error('File not found'));

      const keyBuffer = Buffer.from('new-key');
      const result = await service.verifyHostKeyBuffer('unknown.host.com', 22, keyBuffer);

      expect(result).toBe('unknown');
    });

    it('should return valid for matching key buffer', async () => {
      const keyBuffer = Buffer.from('matching-key-data');
      const keyBase64 = keyBuffer.toString('base64');

      (access as Mock).mockResolvedValue(undefined);
      (readFile as Mock).mockResolvedValue(`valid.host.com ssh-ed25519 ${keyBase64}`);

      const result = await service.verifyHostKeyBuffer('valid.host.com', 22, keyBuffer);

      expect(result).toBe('valid');
    });

    it('should return invalid for non-matching key buffer', async () => {
      const originalKey = Buffer.from('original-key').toString('base64');

      (access as Mock).mockResolvedValue(undefined);
      (readFile as Mock).mockResolvedValue(`invalid.host.com ssh-ed25519 ${originalKey}`);

      const differentKey = Buffer.from('different-key');
      const result = await service.verifyHostKeyBuffer('invalid.host.com', 22, differentKey);

      expect(result).toBe('invalid');
    });
  });

  describe('addHostKey', () => {
    it('should add host key with standard port', async () => {
      (access as Mock).mockRejectedValue(new Error('File not found'));

      await service.addHostKey('new.host.com', 22, 'ssh-ed25519', 'SHA256:abc123def456');

      expect(writeFile).toHaveBeenCalledWith(
        '/home/testuser/.ssh/known_hosts',
        'new.host.com ssh-ed25519 SHA256:abc123def456\n'
      );
    });

    it('should add host key with non-standard port', async () => {
      (access as Mock).mockRejectedValue(new Error('File not found'));

      await service.addHostKey('new.host.com', 2222, 'ssh-ed25519', 'SHA256:abc123def456');

      expect(writeFile).toHaveBeenCalledWith(
        '/home/testuser/.ssh/known_hosts',
        '[new.host.com]:2222 ssh-ed25519 SHA256:abc123def456\n'
      );
    });

    it('should update existing host key', async () => {
      (access as Mock).mockResolvedValue(undefined);
      (readFile as Mock).mockResolvedValue('old.host.com ssh-ed25519 oldkey\n');

      await service.addHostKey('old.host.com', 22, 'ssh-ed25519', 'new-fingerprint');

      expect(writeFile).toHaveBeenCalledWith(
        '/home/testuser/.ssh/known_hosts',
        'old.host.com ssh-ed25519 new-fingerprint\n'
      );
    });
  });

  describe('addKnownHost', () => {
    it('should append host with raw key buffer', async () => {
      (access as Mock).mockRejectedValue(new Error('File not found'));

      const keyBuffer = Buffer.from('raw-key-data');
      await service.addKnownHost('raw.host.com', 22, keyBuffer, 'ssh-ed25519');

      const expectedEntry = 'raw.host.com ssh-ed25519 cmF3LWtleS1kYXRh\n';
      expect(appendFile).toHaveBeenCalledWith('/home/testuser/.ssh/known_hosts', expectedEntry);
    });

    it('should use default algorithm when not specified', async () => {
      (access as Mock).mockRejectedValue(new Error('File not found'));

      const keyBuffer = Buffer.from('key-data');
      await service.addKnownHost('default.algo.com', 22, keyBuffer);

      expect(appendFile).toHaveBeenCalledWith(
        '/home/testuser/.ssh/known_hosts',
        expect.stringContaining('ssh-ed25519')
      );
    });

    it('should throw error when append fails', async () => {
      (access as Mock).mockRejectedValue(new Error('File not found'));
      (appendFile as Mock).mockRejectedValue(new Error('Permission denied'));

      const keyBuffer = Buffer.from('key-data');
      await expect(service.addKnownHost('fail.host.com', 22, keyBuffer)).rejects.toThrow(
        'Failed to write to known_hosts'
      );
    });
  });

  describe('removeHostKey', () => {
    it('should remove host with standard port', async () => {
      (access as Mock).mockResolvedValue(undefined);
      (readFile as Mock).mockResolvedValue(
        `remove.host.com ssh-ed25519 key1\nother.host.com ssh-ed25519 key2\n`
      );

      await service.removeHostKey('remove.host.com', 22);

      expect(writeFile).toHaveBeenCalledWith(
        '/home/testuser/.ssh/known_hosts',
        'other.host.com ssh-ed25519 key2\n'
      );
    });

    it('should remove host with non-standard port', async () => {
      (access as Mock).mockResolvedValue(undefined);
      (readFile as Mock).mockResolvedValue(
        `[remove.host.com]:2222 ssh-ed25519 key1\nother.host.com ssh-ed25519 key2\n`
      );

      await service.removeHostKey('remove.host.com', 2222);

      expect(writeFile).toHaveBeenCalledWith(
        '/home/testuser/.ssh/known_hosts',
        'other.host.com ssh-ed25519 key2\n'
      );
    });

    it('should remove both host and host:port entries', async () => {
      (access as Mock).mockResolvedValue(undefined);
      (readFile as Mock).mockResolvedValue(
        `remove.host.com ssh-ed25519 key1\n[remove.host.com]:2222 ssh-ed25519 key2\n`
      );

      await service.removeHostKey('remove.host.com', 2222);

      const writeCall = (writeFile as Mock).mock.calls[0];
      expect(writeCall[1]).not.toContain('remove.host.com');
    });
  });

  describe('removeKnownHost', () => {
    it('should be alias for removeHostKey', async () => {
      (access as Mock).mockResolvedValue(undefined);
      (readFile as Mock).mockResolvedValue('alias.host.com ssh-ed25519 key\n');

      await service.removeKnownHost('alias.host.com', 22);

      expect(writeFile).toHaveBeenCalled();
    });
  });

  describe('getKnownHosts', () => {
    it('should return all known hosts with metadata', async () => {
      const keyBuffer = Buffer.from('test-key-data');
      const keyBase64 = keyBuffer.toString('base64');
      const expectedFingerprint = service.getFingerprint(keyBuffer);

      (access as Mock).mockResolvedValue(undefined);
      (readFile as Mock).mockResolvedValue(
        `host1.example.com ssh-ed25519 ${keyBase64}\n[host2.example.com]:2222 ssh-rsa ${keyBase64}`
      );

      const hosts = await service.getKnownHosts();

      expect(hosts).toHaveLength(2);
      expect(hosts[0]).toMatchObject({
        host: 'host1.example.com',
        port: 22,
        keyType: 'ssh-ed25519',
        fingerprint: expectedFingerprint,
      });
      expect(hosts[0].verifiedAt).toBeInstanceOf(Date);
    });

    it('should parse host:port format correctly', async () => {
      (access as Mock).mockResolvedValue(undefined);
      (readFile as Mock).mockResolvedValue('[complex.host.com]:2222 ssh-ed25519 keydata');

      const hosts = await service.getKnownHosts();

      expect(hosts[0]).toMatchObject({
        host: 'complex.host.com',
        port: 2222,
      });
    });
  });

  describe('isHostKnown', () => {
    it('should return true for known host', async () => {
      (access as Mock).mockResolvedValue(undefined);
      (readFile as Mock).mockResolvedValue('known.host.com ssh-ed25519 key\n');

      const result = await service.isHostKnown('known.host.com', 22);

      expect(result).toBe(true);
    });

    it('should return false for unknown host', async () => {
      (access as Mock).mockResolvedValue(undefined);
      (readFile as Mock).mockResolvedValue('known.host.com ssh-ed25519 key\n');

      const result = await service.isHostKnown('unknown.host.com', 22);

      expect(result).toBe(false);
    });

    it('should check both host and host:port formats', async () => {
      (access as Mock).mockResolvedValue(undefined);
      (readFile as Mock).mockResolvedValue('[port.host.com]:2222 ssh-ed25519 key\n');

      expect(await service.isHostKnown('port.host.com', 2222)).toBe(true);
      expect(await service.isHostKnown('port.host.com', 22)).toBe(false);
    });
  });

  describe('getHostKeyInfo', () => {
    it('should return host key info object', () => {
      const keyBuffer = Buffer.from('test-key-data');
      const info = service.getHostKeyInfo('info.host.com', 22, keyBuffer, 'ssh-ed25519');

      expect(info).toMatchObject({
        host: 'info.host.com',
        port: 22,
        algorithm: 'ssh-ed25519',
        key: keyBuffer,
      });
      expect(info.fingerprint).toMatch(/^SHA256:/);
    });
  });
});
