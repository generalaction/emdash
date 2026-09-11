import { toast } from '@emdash/ui/react/primitives';
import { Copy, ExternalLink, FileText, FolderOpen, Globe } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';
import type { SelectionLinkKind } from '@core/features/terminals/browser/pty/selection-link';
import { PopoverButton, TerminalPopover } from './terminal-popover';

export interface TerminalSelectionPopoverProps {
  visible: boolean;
  x: number;
  y: number;
  text: string;
  linkKind: SelectionLinkKind;
  isLocalWorkspace: boolean;
  onCopy: (text: string) => Promise<boolean>;
  onOpenFile: (rawPath: string) => void;
  onShowInFileManager: (rawPath: string) => void;
  onOpenInBrowser: (url: string) => void;
  onOpenUrl: (url: string) => void;
  onClose: () => void;
}

/**
 * Floating menu over a terminal selection, ported from Pane's
 * SelectionPopover: Copy always; Open in Browser + Open URL for selections
 * containing a URL; Open in Pane + Show in Explorer for file-path selections.
 */
export const TerminalSelectionPopover: React.FC<TerminalSelectionPopoverProps> = ({
  visible,
  x,
  y,
  text,
  linkKind,
  isLocalWorkspace,
  onCopy,
  onOpenFile,
  onShowInFileManager,
  onOpenInBrowser,
  onOpenUrl,
  onClose,
}) => {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) setError(null);
  }, [visible]);

  const handleCopy = useCallback(async () => {
    const copied = await onCopy(text);
    if (!copied) {
      setError('Failed to copy terminal text');
      return;
    }
    onClose();
  }, [onCopy, text, onClose]);

  const handleOpenFile = useCallback(() => {
    if (linkKind.kind !== 'file') return;
    onOpenFile(linkKind.rawPath);
    onClose();
  }, [linkKind, onOpenFile, onClose]);

  const handleShowInFileManager = useCallback(() => {
    if (linkKind.kind !== 'file') return;
    if (!isLocalWorkspace) {
      setError('Show in Explorer is only available for local workspaces');
      onClose();
      return;
    }
    onShowInFileManager(linkKind.rawPath);
    onClose();
  }, [linkKind, isLocalWorkspace, onShowInFileManager, onClose]);

  const handleOpenInBrowser = useCallback(() => {
    if (linkKind.kind !== 'url') return;
    onOpenInBrowser(linkKind.url);
    onClose();
  }, [linkKind, onOpenInBrowser, onClose]);

  const handleOpenUrl = useCallback(() => {
    if (linkKind.kind !== 'url') return;
    onOpenUrl(linkKind.url);
    onClose();
  }, [linkKind, onOpenUrl, onClose]);

  const isUrl = linkKind.kind === 'url';
  const isFile = linkKind.kind === 'file';

  return (
    <>
      <TerminalPopover visible={visible} x={x} y={y} onClose={onClose}>
        <PopoverButton onClick={handleCopy}>
          <Copy className="size-4 shrink-0" />
          Copy
        </PopoverButton>
        {isUrl && (
          <PopoverButton onClick={handleOpenInBrowser}>
            <Globe className="size-4 shrink-0" />
            Open in Browser
          </PopoverButton>
        )}
        {isUrl && (
          <PopoverButton onClick={handleOpenUrl}>
            <ExternalLink className="size-4 shrink-0" />
            Open URL
          </PopoverButton>
        )}
        {isFile && (
          <PopoverButton onClick={handleOpenFile}>
            <FileText className="size-4 shrink-0" />
            Open in Pane
          </PopoverButton>
        )}
        {isFile && (
          <PopoverButton
            onClick={handleShowInFileManager}
            disabled={!isLocalWorkspace}
            title={!isLocalWorkspace ? 'Only available for local workspaces' : undefined}
          >
            <FolderOpen className="size-4 shrink-0" />
            Show in Explorer{!isLocalWorkspace ? ' (local only)' : ''}
          </PopoverButton>
        )}
      </TerminalPopover>
      {error ? <ToastError error={error} onDone={() => setError(null)} /> : null}
    </>
  );
};

const ToastError: React.FC<{ error: string; onDone: () => void }> = ({ error, onDone }) => {
  useEffect(() => {
    toast.error(error);
    onDone();
  }, [error, onDone]);
  return null;
};
