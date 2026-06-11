import type * as nodeFs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { persistDroppedBlobBytes } from '@main/core/pty/persist-dropped-blob';
import {
  downloadLinearIssueAttachments,
  extractLinearUploadUrls,
} from './linear-issue-attachments';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof nodeFs>();
  return { ...actual, existsSync: vi.fn(() => true) };
});

vi.mock('@main/core/pty/persist-dropped-blob', () => ({
  persistDroppedBlobBytes: vi.fn(),
}));

const mockPersist = vi.mocked(persistDroppedBlobBytes);
const fetchMock = vi.fn();
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

function imageResponse(status = 200, contentType = 'image/png'): Response {
  return new Response(new Uint8Array([1, 2, 3]), {
    status,
    headers: { 'content-type': contentType },
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  mockPersist.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('extractLinearUploadUrls', () => {
  it('extracts and dedupes uploads.linear.app URLs from markdown', () => {
    const urls = extractLinearUploadUrls([
      'Before ![shot](https://uploads.linear.app/abc/def/screenshot.png) after.',
      'Same link again: https://uploads.linear.app/abc/def/screenshot.png.',
      'Other host stays out: https://example.com/image.png',
      undefined,
    ]);

    expect(urls).toEqual(['https://uploads.linear.app/abc/def/screenshot.png']);
  });

  it('strips trailing punctuation from bare URLs', () => {
    expect(extractLinearUploadUrls(['See https://uploads.linear.app/abc/def, please.'])).toEqual([
      'https://uploads.linear.app/abc/def',
    ]);
  });
});

describe('downloadLinearIssueAttachments', () => {
  it('downloads images with the Linear token and persists them locally', async () => {
    fetchMock.mockResolvedValue(imageResponse());
    mockPersist.mockResolvedValue('/tmp/emdash-drop-1-ENG-1-a.png');

    const attachments = await downloadLinearIssueAttachments({
      token: 'lin_api_test',
      identifier: 'ENG-1',
      texts: ['![a](https://uploads.linear.app/org/file/a.png)'],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://uploads.linear.app/org/file/a.png',
      expect.objectContaining({ headers: { Authorization: 'lin_api_test' } })
    );
    expect(mockPersist).toHaveBeenCalledWith({
      bytes: expect.any(Uint8Array),
      name: 'ENG-1-a.png',
      mimeType: 'image/png',
    });
    expect(attachments).toEqual([
      {
        url: 'https://uploads.linear.app/org/file/a.png',
        localPath: '/tmp/emdash-drop-1-ENG-1-a.png',
      },
    ]);
  });

  it('retries with the Bearer scheme when the raw token is rejected', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(imageResponse());
    mockPersist.mockResolvedValue('/tmp/emdash-drop-2-ENG-2-b.png');

    const attachments = await downloadLinearIssueAttachments({
      token: 'oauth-token',
      identifier: 'ENG-2',
      texts: ['https://uploads.linear.app/org/file/b.png'],
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://uploads.linear.app/org/file/b.png',
      expect.objectContaining({ headers: { Authorization: 'Bearer oauth-token' } })
    );
    expect(attachments).toHaveLength(1);
  });

  it('skips non-image uploads such as videos', async () => {
    fetchMock.mockResolvedValue(imageResponse(200, 'video/mp4'));

    const attachments = await downloadLinearIssueAttachments({
      token: 'lin_api_test',
      identifier: 'ENG-3',
      texts: ['https://uploads.linear.app/org/file/demo.mp4'],
    });

    expect(attachments).toEqual([]);
    expect(mockPersist).not.toHaveBeenCalled();
  });

  it('skips oversized images from content-length without reading the body', async () => {
    const arrayBuffer = vi.spyOn(Response.prototype, 'arrayBuffer');
    fetchMock.mockResolvedValue(
      new Response(null, {
        status: 200,
        headers: {
          'content-length': String(MAX_ATTACHMENT_BYTES + 1),
          'content-type': 'image/png',
        },
      })
    );

    const attachments = await downloadLinearIssueAttachments({
      token: 'lin_api_test',
      identifier: 'ENG-4',
      texts: ['https://uploads.linear.app/org/file/too-large.png'],
    });

    expect(attachments).toEqual([]);
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(mockPersist).not.toHaveBeenCalled();
  });

  it('stops streaming images once they exceed the size limit', async () => {
    let chunkCount = 0;
    fetchMock.mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            chunkCount += 1;
            if (chunkCount > 25) {
              controller.close();
              return;
            }
            controller.enqueue(new Uint8Array(1024 * 1024));
          },
        }),
        { status: 200, headers: { 'content-type': 'image/png' } }
      )
    );

    const attachments = await downloadLinearIssueAttachments({
      token: 'lin_api_test',
      identifier: 'ENG-5',
      texts: ['https://uploads.linear.app/org/file/stream-too-large.png'],
    });

    expect(attachments).toEqual([]);
    expect(chunkCount).toBeLessThan(25);
    expect(mockPersist).not.toHaveBeenCalled();
  });

  it('omits failed downloads without throwing', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(imageResponse());
    mockPersist.mockResolvedValue('/tmp/emdash-drop-3-ENG-4-ok.png');

    const attachments = await downloadLinearIssueAttachments({
      token: 'lin_api_test',
      identifier: 'ENG-4',
      texts: [
        'https://uploads.linear.app/org/file/broken.png and https://uploads.linear.app/org/file/ok.png',
      ],
    });

    expect(attachments).toEqual([
      {
        url: 'https://uploads.linear.app/org/file/ok.png',
        localPath: '/tmp/emdash-drop-3-ENG-4-ok.png',
      },
    ]);
  });

  it('reuses previously downloaded files for the same URL', async () => {
    fetchMock.mockResolvedValue(imageResponse());
    mockPersist.mockResolvedValue('/tmp/emdash-drop-4-ENG-5-cached.png');

    const args = {
      token: 'lin_api_test',
      identifier: 'ENG-5',
      texts: ['https://uploads.linear.app/org/file/cached.png'],
    };
    await downloadLinearIssueAttachments(args);
    const attachments = await downloadLinearIssueAttachments(args);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(attachments).toEqual([
      {
        url: 'https://uploads.linear.app/org/file/cached.png',
        localPath: '/tmp/emdash-drop-4-ENG-5-cached.png',
      },
    ]);
  });

  it('does not reuse cached downloads across different Linear tokens', async () => {
    fetchMock.mockResolvedValue(imageResponse());
    mockPersist
      .mockResolvedValueOnce('/tmp/emdash-drop-5-ENG-6-token-a.png')
      .mockResolvedValueOnce('/tmp/emdash-drop-6-ENG-6-token-b.png');

    const baseArgs = {
      identifier: 'ENG-6',
      texts: ['https://uploads.linear.app/org/file/token-scoped.png'],
    };

    await downloadLinearIssueAttachments({ ...baseArgs, token: 'lin_api_token_a' });
    const attachments = await downloadLinearIssueAttachments({
      ...baseArgs,
      token: 'lin_api_token_b',
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(attachments).toEqual([
      {
        url: 'https://uploads.linear.app/org/file/token-scoped.png',
        localPath: '/tmp/emdash-drop-6-ENG-6-token-b.png',
      },
    ]);
  });
});
