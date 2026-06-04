import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SHARE_MAX_PAYLOAD_BYTES } from '@shared/share';
import { ShareService } from './share-service';

const mockGetShareBaseUrl = vi.fn(() => 'https://share.test.emdash.sh');
vi.mock('./config', () => ({
  getShareBaseUrl: () => mockGetShareBaseUrl(),
  SHARE_CONFIG: { timeoutMs: 15_000 },
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('ShareService', () => {
  let service: ShareService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetShareBaseUrl.mockReturnValue('https://share.test.emdash.sh');
    service = new ShareService();
  });

  it('creates skill shares against the typed endpoint', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ id: 'abc123', url: 'https://share.test/skills/abc123' })
    );

    const result = await service.createShare({
      type: 'skill',
      skill: {
        name: 'pdf-tools',
        displayName: 'PDF Tools',
        description: 'Work with PDFs',
        skillMdContent: 'content',
      },
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://share.test.emdash.sh/api/skills',
      expect.objectContaining({ method: 'POST' })
    );
    expect(result).toEqual({ id: 'abc123', url: 'https://share.test/skills/abc123' });
  });

  it('reads the base URL when creating a share', async () => {
    mockGetShareBaseUrl.mockReturnValue('http://localhost:8787');
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ id: 'abc123', url: 'http://localhost:8787/prompts/abc123' })
    );

    await service.createShare({ type: 'prompt', prompt: { title: 'Review', prompt: 'Do it' } });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:8787/api/prompts',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('rejects oversized payloads before fetching', async () => {
    await expect(
      service.createShare({
        type: 'prompt',
        prompt: { title: 'Big', prompt: 'x'.repeat(SHARE_MAX_PAYLOAD_BYTES + 1) },
      })
    ).rejects.toThrow();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('throws non-2xx response errors', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: 'rate limited' }, 429));

    await expect(
      service.createShare({ type: 'prompt', prompt: { title: 'Review', prompt: 'Do it' } })
    ).rejects.toThrow('rate limited');
  });

  it('rejects invalid fetch ids', async () => {
    await expect(service.fetchShare('skill', '../bad')).rejects.toThrow('Invalid share id');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('validates fetch responses', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ id: 'abc123', payload: { type: 'skill' } }));

    await expect(service.fetchShare('skill', 'abc123')).rejects.toThrow();
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}
