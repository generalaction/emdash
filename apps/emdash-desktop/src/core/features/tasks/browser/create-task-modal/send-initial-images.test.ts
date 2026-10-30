import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InitialImageAttachment } from '@core/features/tasks/contributions/browser/task-config/initial-conversation-section';
import { sendInitialImages } from './send-initial-images';

const mocks = vi.hoisted(() => ({
  upload: vi.fn(),
  attach: vi.fn(),
  startSession: vi.fn(),
  sendPrompt: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@core/features/conversations/api/browser/client', () => ({
  getConversationsClient: async () => ({
    attachments: { upload: mocks.upload },
    acp: {
      attach: mocks.attach,
      startSession: mocks.startSession,
      sendPrompt: mocks.sendPrompt,
    },
  }),
}));
vi.mock('@emdash/ui/react/primitives', () => ({ toast: { error: mocks.toastError } }));

const file = {
  name: 'screenshot.png',
  type: 'image/png',
  size: 3,
  stream: () => new ReadableStream<Uint8Array>(),
} as File;
const image: InitialImageAttachment = {
  id: 'draft-image',
  file,
  previewUrl: 'data:image/png;base64,',
};

describe('sendInitialImages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.upload.mockResolvedValue({
      success: true,
      data: { id: 'stored-image', name: 'screenshot.png' },
    });
    mocks.attach.mockResolvedValue({ success: true, data: { sessionId: null } });
    mocks.startSession.mockResolvedValue({ success: true, data: { sessionId: 'session' } });
    mocks.sendPrompt.mockResolvedValue({ success: true, data: { queued: false } });
  });

  it('uploads the image and sends it with the initial ticket context', async () => {
    await sendInitialImages(
      {
        id: 'conversation',
        provider: 'claude',
        initialQueue: [{ text: 'Fix this ticket', hiddenContext: 'Ticket details' }],
      },
      [image],
      'Fix this ticket'
    );

    expect(mocks.upload).toHaveBeenCalledWith(
      { conversationId: 'conversation' },
      expect.objectContaining({ name: 'screenshot.png', mimeType: 'image/png', size: 3 })
    );
    expect(mocks.startSession).toHaveBeenCalledWith({
      conversationId: 'conversation',
      mode: 'fresh',
    });
    expect(mocks.sendPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conversation',
        prompt: {
          text: 'Fix this ticket',
          hiddenContext: 'Ticket details',
          attachments: [
            {
              type: 'attachment',
              id: 'stored-image',
              mimeType: 'image/png',
              name: 'screenshot.png',
            },
          ],
        },
      }),
      { timeoutMs: 0 }
    );
  });

  it('allows an image-only first message', async () => {
    await sendInitialImages({ id: 'conversation', provider: 'claude' }, [image], '');
    expect(mocks.sendPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.objectContaining({ text: '', attachments: [expect.any(Object)] }),
      }),
      { timeoutMs: 0 }
    );
  });
});
