import { ChatTranscript, createChatContext, createChatState } from '@emdash/ui/react/chat-ui';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Download,
  ImagePlus,
  ListPlus,
  Paperclip,
  Save,
  Send,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { createMobileUuid } from '../browser-compat';
import { useMobileClient } from '../client/context';
import type {
  AcpDraft,
  AcpPromptInput,
  AcpResourceHandle,
  PromptAttachment,
} from '../client/types';

const chatContext = createChatContext({});
const acceptedImageTypes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const maxAttachmentBytes = 10 * 1024 * 1024;

interface LocalAttachment {
  payload: PromptAttachment;
  previewUrl: string;
}

export function AcpView({ handle }: { handle: AcpResourceHandle }) {
  const client = useMobileClient();
  const [state] = useState(() => createChatState(chatContext));
  const [text, setText] = useState(handle.draft.text);
  const [revision, setRevision] = useState(handle.draft.revision);
  const [working, setWorking] = useState(handle.isWorking);
  const [attachments, setAttachments] = useState<LocalAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState('');
  const [actionError, setActionError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [queueEdits, setQueueEdits] = useState<Record<string, string>>({});
  const [draftConflict, setDraftConflict] = useState<AcpDraft>();
  const serverDraft = useRef(handle.draft);
  const fileInput = useRef<HTMLInputElement>(null);
  const attachmentsRef = useRef<LocalAttachment[]>([]);

  useEffect(() => () => state.dispose(), [state]);
  useEffect(() => state.transcript.history.seed(handle.transcript), [handle.transcript, state]);
  useEffect(
    () =>
      state.session.setTerminalOutputs(
        new Map(handle.terminalOutputs.map(({ terminalId, output }) => [terminalId, output]))
      ),
    [handle.terminalOutputs, state]
  );
  useEffect(() => {
    setWorking(handle.isWorking);
  }, [handle.isWorking]);
  useEffect(() => {
    if (handle.draft.revision <= revision) return;
    serverDraft.current = handle.draft;
    setRevision(handle.draft.revision);
    setText(handle.draft.text);
  }, [handle.draft, revision]);
  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);
  useEffect(
    () => () => {
      for (const attachment of attachmentsRef.current) URL.revokeObjectURL(attachment.previewUrl);
    },
    []
  );

  useEffect(() => {
    if (text === serverDraft.current.text) return;
    const timer = window.setTimeout(() => {
      void client
        .updateDraft(handle.handleId, revision, promptInput(serverDraft.current, text))
        .then((result) => {
          if (result.accepted) {
            serverDraft.current = result.current;
            setRevision(result.current.revision);
          } else {
            setDraftConflict(result.current);
          }
        })
        .catch((reason: unknown) => {
          setActionError(errorMessage(reason, 'Could not sync the draft.'));
        });
    }, 450);
    return () => window.clearTimeout(timer);
  }, [client, handle.handleId, revision, text]);

  useEffect(
    () =>
      client.subscribe((event) => {
        if ('handleId' in event && event.handleId !== handle.handleId) return;
        if (event.type === 'acp.transcript') state.transcript.history.seed(event.transcript);
        if (event.type === 'acp.working') setWorking(event.isWorking);
        if (event.type === 'acp.draft' && event.draft.revision > revision) {
          serverDraft.current = event.draft;
          setRevision(event.draft.revision);
          setText(event.draft.text);
        }
      }),
    [client, handle.handleId, revision, state]
  );

  const chooseAttachments = async (event: ChangeEvent<HTMLInputElement>) => {
    setAttachmentError('');
    const next: LocalAttachment[] = [];
    for (const file of Array.from(event.target.files ?? [])) {
      if (!acceptedImageTypes.has(file.type)) {
        setAttachmentError('Use PNG, JPEG, GIF, or WebP images.');
        continue;
      }
      if (file.size > maxAttachmentBytes) {
        setAttachmentError(`${file.name} is larger than 10 MB.`);
        continue;
      }
      next.push({
        payload: {
          id: createMobileUuid(),
          name: file.name,
          mimeType: file.type as PromptAttachment['mimeType'],
          bytes: new Uint8Array(await file.arrayBuffer()),
        },
        previewUrl: URL.createObjectURL(file),
      });
    }
    setAttachments((current) => [...current, ...next].slice(0, 4));
    event.target.value = '';
  };

  const removeAttachment = (id: string) => {
    setAttachments((current) => {
      const removed = current.find((attachment) => attachment.payload.id === id);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return current.filter((attachment) => attachment.payload.id !== id);
    });
  };

  const send = async () => {
    const prompt = text.trim();
    if (!prompt || submitting) return;
    const submittedAttachments = attachments;
    const payloads = submittedAttachments.map((attachment) => attachment.payload);
    const submittedIds = new Set(payloads.map((attachment) => attachment.id));
    const input = promptInput(serverDraft.current, prompt);
    setActionError('');
    setSubmitting(true);
    try {
      if (working) await client.queuePrompt(handle.handleId, input, payloads);
      else await client.sendPrompt(handle.handleId, input, payloads);
      for (const attachment of submittedAttachments) {
        URL.revokeObjectURL(attachment.previewUrl);
      }
      setAttachments((current) =>
        current.filter((attachment) => !submittedIds.has(attachment.payload.id))
      );
      setText((current) => {
        if (current.trim() !== prompt) return current;
        serverDraft.current = { revision: serverDraft.current.revision, text: '' };
        return '';
      });
    } catch (reason) {
      setActionError(errorMessage(reason, 'Could not submit the prompt.'));
    } finally {
      setSubmitting(false);
    }
  };

  const runAction = async (action: () => Promise<void>, fallback: string): Promise<boolean> => {
    setActionError('');
    try {
      await action();
      return true;
    } catch (reason) {
      setActionError(errorMessage(reason, fallback));
      return false;
    }
  };

  const moveQueuedPrompt = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= handle.queue.length) return;
    const ids = handle.queue.map((prompt) => prompt.id);
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    await runAction(
      () => client.reorderQueuedPrompts(handle.handleId, ids),
      'Could not reorder the queued prompts.'
    );
  };

  const exportTranscript = async (format: 'parsed' | 'raw') => {
    setActionError('');
    try {
      const exported = await client.exportTranscript(handle.handleId, format);
      const url = URL.createObjectURL(new Blob([exported.content], { type: exported.mimeType }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = exported.name;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (reason) {
      setActionError(errorMessage(reason, 'Could not export the transcript.'));
    }
  };

  const selectOption = (
    option: 'model' | 'mode' | 'effort',
    event: ChangeEvent<HTMLSelectElement>
  ) => {
    const value = event.target.value;
    void runAction(
      () => client.updateAcpOption(handle.handleId, option, value),
      `Could not update ${option}.`
    );
  };

  return (
    <div className="acp-view">
      <div className="acp-controls" aria-label="Agent controls">
        {handle.availableModels.length > 0 && (
          <select
            aria-label="Model"
            defaultValue={handle.model}
            onChange={(event) => selectOption('model', event)}
          >
            {handle.availableModels.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        )}
        {handle.availableModes.length > 0 && (
          <select
            aria-label="Mode"
            defaultValue={handle.mode}
            onChange={(event) => selectOption('mode', event)}
          >
            {handle.availableModes.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        )}
        {handle.availableEfforts.length > 0 && (
          <select
            aria-label="Reasoning effort"
            defaultValue={handle.effort}
            onChange={(event) => selectOption('effort', event)}
          >
            {handle.availableEfforts.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          className="acp-export"
          onClick={() => void exportTranscript('parsed')}
          aria-label="Export parsed transcript"
        >
          <Download size={14} /> Transcript
        </button>
        <button
          type="button"
          className="acp-export"
          onClick={() => void exportTranscript('raw')}
          aria-label="Export raw ACP log"
        >
          <Download size={14} /> Raw
        </button>
      </div>

      <div className="chat-transcript">
        <ChatTranscript
          context={chatContext}
          state={state}
          composer="none"
          stickToBottom
          pinUserMessages
        />
      </div>

      <div className="mobile-composer-wrap">
        {handle.permission && (
          <div className="permission-card">
            <div>
              <AlertTriangle size={17} />
              <span>
                <strong>{handle.permission.title}</strong>
                {handle.permission.description && <small>{handle.permission.description}</small>}
              </span>
            </div>
            <div>
              {handle.permission.options.map((option) => (
                <button
                  type="button"
                  key={option.id}
                  data-tone={option.tone}
                  onClick={() => {
                    const permissionId = handle.permission?.id;
                    if (!permissionId) return;
                    void runAction(
                      () => client.respondToPermission(handle.handleId, permissionId, option.id),
                      'Could not answer the permission request.'
                    );
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {draftConflict && (
          <div className="draft-conflict">
            <span>Draft changed on another device.</span>
            <button
              type="button"
              onClick={() => {
                setRevision(draftConflict.revision);
                serverDraft.current = draftConflict;
                setDraftConflict(undefined);
              }}
            >
              Keep mine
            </button>
            <button
              type="button"
              onClick={() => {
                setRevision(draftConflict.revision);
                setText(draftConflict.text);
                serverDraft.current = draftConflict;
                setDraftConflict(undefined);
              }}
            >
              Use other
            </button>
          </div>
        )}
        {handle.queue.length > 0 && (
          <div className="prompt-queue">
            <span className="queue-title">{handle.queue.length} queued</span>
            <div className="queue-items">
              {handle.queue.map((prompt, index) => {
                const value = queueEdits[prompt.id] ?? prompt.text;
                return (
                  <div className="queue-item" key={prompt.id}>
                    <textarea
                      value={value}
                      aria-label={`Queued prompt ${index + 1}`}
                      onChange={(event) =>
                        setQueueEdits((current) => ({
                          ...current,
                          [prompt.id]: event.target.value,
                        }))
                      }
                    />
                    <div>
                      <button
                        type="button"
                        aria-label="Save queued prompt"
                        disabled={!value.trim() || value === prompt.text}
                        onClick={() => {
                          const input = {
                            text: value.trim(),
                            ...(prompt.hiddenContext === undefined
                              ? {}
                              : { hiddenContext: prompt.hiddenContext }),
                            ...(prompt.attachments === undefined
                              ? {}
                              : { attachments: prompt.attachments }),
                          };
                          void runAction(
                            () => client.editQueuedPrompt(handle.handleId, prompt.id, input),
                            'Could not save the queued prompt.'
                          ).then((saved) => {
                            if (!saved) return;
                            setQueueEdits((current) => {
                              const next = { ...current };
                              delete next[prompt.id];
                              return next;
                            });
                          });
                        }}
                      >
                        <Save size={13} />
                      </button>
                      <button
                        type="button"
                        aria-label="Move queued prompt up"
                        disabled={index === 0}
                        onClick={() => void moveQueuedPrompt(index, -1)}
                      >
                        <ArrowUp size={13} />
                      </button>
                      <button
                        type="button"
                        aria-label="Move queued prompt down"
                        disabled={index === handle.queue.length - 1}
                        onClick={() => void moveQueuedPrompt(index, 1)}
                      >
                        <ArrowDown size={13} />
                      </button>
                      <button
                        type="button"
                        aria-label="Delete queued prompt"
                        onClick={() =>
                          void runAction(
                            () => client.deleteQueuedPrompt(handle.handleId, prompt.id),
                            'Could not delete the queued prompt.'
                          )
                        }
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {attachments.length > 0 && (
          <div className="attachment-strip">
            {attachments.map((attachment) => (
              <div key={attachment.payload.id}>
                <img src={attachment.previewUrl} alt={attachment.payload.name} />
                <button
                  type="button"
                  aria-label={`Remove ${attachment.payload.name}`}
                  onClick={() => removeAttachment(attachment.payload.id)}
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
        {attachmentError && <p className="composer-error">{attachmentError}</p>}
        {actionError && <p className="composer-error">{actionError}</p>}
        <div className="mobile-composer">
          <textarea
            value={text}
            rows={1}
            placeholder={working ? 'Agent is working…' : 'Message the agent'}
            aria-label="Message the agent"
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
          />
          <div className="composer-actions">
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              multiple
              hidden
              onChange={chooseAttachments}
            />
            <button
              type="button"
              className="composer-attach"
              aria-label="Attach image"
              onClick={() => fileInput.current?.click()}
            >
              {attachments.length > 0 ? <ImagePlus size={19} /> : <Paperclip size={19} />}
            </button>
            {working ? (
              <>
                <button
                  type="button"
                  className="composer-send queue"
                  aria-label="Queue prompt"
                  disabled={!text.trim() || submitting}
                  onClick={() => void send()}
                >
                  <ListPlus size={16} />
                </button>
                <button
                  type="button"
                  className="composer-send stop"
                  aria-label="Stop agent"
                  onClick={() =>
                    void runAction(
                      () => client.cancelPrompt(handle.handleId),
                      'Could not stop the agent.'
                    )
                  }
                >
                  <Square size={14} fill="currentColor" />
                </button>
              </>
            ) : (
              <button
                type="button"
                className="composer-send"
                aria-label="Send message"
                disabled={!text.trim() || submitting}
                onClick={() => void send()}
              >
                <Send size={17} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function errorMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}

function promptInput(draft: AcpDraft, text: string): AcpPromptInput {
  return {
    text,
    ...(draft.hiddenContext === undefined ? {} : { hiddenContext: draft.hiddenContext }),
    ...(draft.attachments === undefined ? {} : { attachments: draft.attachments }),
  };
}
