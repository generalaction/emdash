import React, { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { Button } from './ui/button';
import { ArrowRight } from 'lucide-react';
// Provider selection handled by ProviderSelector component
import { useFileIndex } from '../hooks/useFileIndex';
import FileTypeIcon from './ui/file-type-icon';
import { ProviderSelector } from './ProviderSelector';
import { type Provider } from '../types';

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onCancel: () => void;
  isLoading: boolean;
  loadingSeconds: number;
  isCodexInstalled: boolean | null;
  agentCreated: boolean;
  disabled?: boolean;
  workspacePath?: string;
  provider?: Provider;
  onProviderChange?: (p: Provider) => void;
  selectDisabled?: boolean;
  // Image attachments (paths relative to workspace)
  imageAttachments?: string[];
  onAttachImages?: (filePaths: string[]) => void;
  onRemoveImage?: (relPath: string) => void;
}

const MAX_LOADING_SECONDS = 60 * 60; // 60 minutes

const formatLoadingTime = (seconds: number): string => {
  if (seconds <= 0) return '0s';

  const clamped = Math.min(seconds, MAX_LOADING_SECONDS);
  const minutes = Math.floor(clamped / 60);
  const remainingSeconds = clamped % 60;

  if (minutes >= 60) {
    return '60m';
  }

  if (minutes === 0) {
    return `${clamped}s`;
  }

  if (remainingSeconds === 0) {
    return `${minutes}m`;
  }

  return `${minutes}m ${remainingSeconds}s`;
};

export const ChatInput: React.FC<ChatInputProps> = ({
  value,
  onChange,
  onSend,
  onCancel,
  isLoading,
  loadingSeconds,
  isCodexInstalled,
  agentCreated,
  disabled = false,
  workspacePath,
  provider = 'codex',
  onProviderChange,
  selectDisabled = false,
  imageAttachments = [],
  onAttachImages,
  onRemoveImage,
}) => {
  const [isFocused, setIsFocused] = useState(false);
  // Provider is controlled by parent (codex | claude | droid | gemini | cursor | copilot)
  const shouldReduceMotion = useReducedMotion();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // File index for @ mention
  const { search } = useFileIndex(workspacePath);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionStart, setMentionStart] = useState<number | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionResults, setMentionResults] = useState<
    Array<{ path: string; type: 'file' | 'dir' }>
  >([]);

  // Debounce mention search to avoid heavy sync work on every keystroke in large repos
  useEffect(() => {
    if (!mentionOpen) {
      setMentionResults([]);
      return;
    }
    const handle = setTimeout(() => {
      try {
        setMentionResults(search(mentionQuery, 12));
      } catch {
        setMentionResults([]);
      }
    }, 120);
    return () => clearTimeout(handle);
  }, [mentionOpen, mentionQuery, search]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Send on Enter (unless Shift) when mention is closed
    if (e.key === 'Enter' && !e.shiftKey && !mentionOpen) {
      e.preventDefault();
      if (!isLoading) onSend();
      return;
    }

    // Mention navigation
    if (mentionOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionIndex((i) => Math.min(i + 1, Math.max(mentionResults.length - 1, 0)));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const pick = mentionResults[mentionIndex];
        if (pick) applyMention(pick.path);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        closeMention();
        return;
      }
    }
  };

  function openMention(start: number, query: string) {
    setMentionStart(start);
    setMentionQuery(query);
    setMentionIndex(0);
    setMentionOpen(true);
  }

  function closeMention() {
    setMentionOpen(false);
    setMentionQuery('');
    setMentionStart(null);
    setMentionIndex(0);
  }

  function detectMention(nextValue: string, caret: number) {
    // Find the nearest '@' to the left of caret that starts a token
    // Token continues until whitespace or line break
    let i = caret - 1;
    while (i >= 0) {
      const ch = nextValue[i];
      if (ch === '@') break;
      if (/\s/.test(ch)) return closeMention();
      i--;
    }
    if (i < 0 || nextValue[i] !== '@') return closeMention();

    const start = i; // position of '@'
    const query = nextValue.slice(start + 1, caret);
    openMention(start, query);
  }

  function applyMention(pickPath: string) {
    if (mentionStart == null) return;
    const el = textareaRef.current;
    const caret = el ? el.selectionStart : value.length;
    const before = value.slice(0, mentionStart);
    const after = value.slice(caret);
    // Keep leading '@', insert selected relative path
    const next = `${before}@${pickPath}${after}`;
    onChange(next);
    closeMention();
    // Restore caret after inserted text
    requestAnimationFrame(() => {
      if (el) {
        const pos = before.length + 1 + pickPath.length;
        el.selectionStart = el.selectionEnd = pos;
        el.focus();
      }
    });
  }

  const getPlaceholder = () => {
    if (provider === 'codex' && !isCodexInstalled) {
      return 'Codex CLI not installed...';
    }
    if (!agentCreated) {
      return 'Initializing...';
    }
    if (provider === 'claude') return 'Tell Claude Code what to do...';
    if (provider === 'droid') return 'Factory Droid uses the terminal above.';
    if (provider === 'gemini') return 'Gemini CLI uses the terminal above.';
    if (provider === 'kimi') return 'Kimi CLI runs in the terminal below.';
    if (provider === 'cursor') return 'Cursor CLI runs in the terminal above.';
    if (provider === 'copilot') return 'Copilot CLI runs in the terminal above.';
    if (provider === 'amp') return 'Amp CLI runs in the terminal above.';
    if (provider === 'opencode') return 'OpenCode CLI runs in the terminal above.';
    if (provider === 'rovo')
      return 'Rovo Dev (Atlassian) runs in the terminal above.';
    return 'Tell Codex what to do...';
  };

  const trimmedValue = value.trim();
  const baseDisabled =
    disabled ||
    (provider === 'codex'
      ? !isCodexInstalled || !agentCreated
      : provider === 'claude'
        ? !agentCreated
        : true); // droid/gemini/cursor/copilot: input disabled, terminal-only

  const textareaDisabled = baseDisabled || isLoading;
  const sendDisabled =
    provider === 'droid' ||
    provider === 'gemini' ||
    provider === 'cursor' ||
    provider === 'copilot' ||
    provider === 'amp' ||
    provider === 'opencode' ||
    provider === 'kimi' ||
    provider === 'rovo'
      ? true
      : isLoading
        ? baseDisabled
        : baseDisabled || !trimmedValue;

  // Drag & drop images into the input area
  const handleDrop = (e: React.DragEvent) => {
    if (!workspacePath) return;
    if (!e.dataTransfer || !e.dataTransfer.files) return;
    e.preventDefault();
    const files: string[] = [];
    for (let i = 0; i < e.dataTransfer.files.length; i++) {
      const f = e.dataTransfer.files[i] as any;
      const name: string = f.name || '';
      const path: string | undefined = (f as any).path;
      const type: string = f.type || '';
      const isImage = type.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name);
      if (isImage && path) files.push(path);
    }
    if (files.length > 0) onAttachImages?.(files);
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (!workspacePath) return;
    e.preventDefault();
  };

  return (
    <div className="px-6 pb-6 pt-4" onDrop={handleDrop} onDragOver={handleDragOver}>
      <div className="mx-auto max-w-4xl">
        <div
          className={`relative rounded-md border border-gray-200 bg-white transition-shadow duration-200 dark:border-gray-700 dark:bg-gray-800 ${
            isFocused ? 'shadow-2xl' : 'shadow-lg'
          }`}
        >
          <div className="p-4">
            {imageAttachments && imageAttachments.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-2">
                {imageAttachments.map((rel) => (
                  <div
                    key={rel}
                    className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-gray-50 px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-700"
                  >
                    <span className="max-w-[220px] truncate">{rel}</span>
                    <button
                      type="button"
                      aria-label="Remove image"
                      className="text-gray-500 hover:text-gray-800 dark:text-gray-300 dark:hover:text-white"
                      onClick={() => onRemoveImage?.(rel)}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            <textarea
              ref={textareaRef}
              className="w-full resize-none border-none bg-transparent text-sm text-gray-900 placeholder-gray-500 outline-none dark:text-gray-100 dark:placeholder-gray-400"
              value={value}
              onChange={(e) => {
                const next = e.target.value;
                onChange(next);
                const caret = e.target.selectionStart ?? next.length;
                detectMention(next, caret);
              }}
              onKeyDown={handleKeyDown}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              placeholder={getPlaceholder()}
              rows={2}
              disabled={textareaDisabled}
              style={{ minHeight: '56px' }}
            />
            {mentionOpen && mentionResults.length > 0 && (
              <div className="absolute bottom-40 left-4 z-20 w-[520px] max-w-[calc(100%-2rem)] overflow-hidden rounded-md border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-800">
                <div className="max-h-64 overflow-y-auto">
                  {mentionResults.map((item, idx) => (
                    <button
                      key={`${item.type}:${item.path}`}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        applyMention(item.path);
                      }}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-gray-100 dark:hover:bg-gray-700 ${
                        idx === mentionIndex ? 'bg-gray-100 dark:bg-gray-700' : ''
                      }`}
                    >
                      <span className="inline-flex h-4 w-4 items-center justify-center text-gray-500">
                        <FileTypeIcon path={item.path} type={item.type} size={14} />
                      </span>
                      <span className="truncate text-gray-800 dark:text-gray-200">{item.path}</span>
                    </button>
                  ))}
                </div>
                <div className="border-t border-gray-200 px-3 py-1 text-[10px] text-gray-500 dark:border-gray-700">
                  Type to filter files and folders • ↑/↓ to navigate • Enter to insert
                </div>
              </div>
            )}
          </div>

          <div className="relative flex items-center justify-between rounded-b-xl px-4 py-3">
            <div className="flex items-center gap-2">
              <ProviderSelector
                value={provider as Provider}
                onChange={(v) => {
                  if (!selectDisabled && onProviderChange) onProviderChange(v);
                }}
                disabled={selectDisabled}
              />
            </div>

            <div className="flex items-center gap-2">
              {isLoading && (
                <span className="w-16 text-right text-xs font-medium tabular-nums text-gray-500 dark:text-gray-400">
                  {formatLoadingTime(loadingSeconds)}
                </span>
              )}
              <Button
                type="button"
                onClick={isLoading ? onCancel : onSend}
                disabled={sendDisabled}
                className={`group relative h-9 w-9 rounded-md p-0 text-gray-600 transition-colors disabled:pointer-events-none disabled:opacity-50 dark:text-gray-300 ${
                  isLoading
                    ? 'bg-gray-200 hover:bg-red-300 hover:text-white dark:bg-gray-700 dark:hover:text-white'
                    : 'bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600'
                }`}
                aria-label={
                  provider === 'droid' ||
                  provider === 'gemini' ||
                  provider === 'cursor' ||
                  provider === 'copilot' ||
                  provider === 'amp' ||
                  provider === 'opencode' ||
                  provider === 'kimi'
                    ? 'Terminal-only provider'
                    : isLoading
                      ? 'Stop Codex'
                      : 'Send'
                }
              >
                {provider === 'droid' ||
                provider === 'gemini' ||
                provider === 'cursor' ||
                provider === 'copilot' ||
                provider === 'amp' ||
                provider === 'opencode' ||
                provider === 'kimi' ? (
                  <div className="flex h-full w-full items-center justify-center">
                    <div className="h-3.5 w-3.5 rounded-[3px] bg-gray-500 dark:bg-gray-300" />
                  </div>
                ) : isLoading ? (
                  <div className="flex h-full w-full items-center justify-center">
                    <div className="h-3.5 w-3.5 rounded-[3px] bg-gray-500 transition-colors duration-150 group-hover:bg-red-500 dark:bg-gray-300" />
                  </div>
                ) : (
                  <ArrowRight className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatInput;
