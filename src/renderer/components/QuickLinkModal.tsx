import React, { useCallback, useEffect, useState } from 'react';
import { Button } from './ui/button';
import { DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Separator } from './ui/separator';
import { Spinner } from './ui/spinner';

interface QuickLinkModalProps {
  owner: string;
  repo: string;
  repoUrl: string;
  onClose: () => void;
  onSuccess: (projectPath: string) => void;
}

export const QuickLinkModal: React.FC<QuickLinkModalProps> = ({
  owner,
  repo,
  repoUrl,
  onClose,
  onSuccess,
}) => {
  const [isCloning, setIsCloning] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    setProgress('');
  }, []);

  const handleClone = useCallback(async () => {
    setIsCloning(true);
    setError(null);
    setProgress('Cloning repository...');

    try {
      const result = await window.electronAPI.githubQuickLinkClone({ owner, repo, repoUrl });
      if (!result.success) {
        throw new Error(result.error || 'Clone failed');
      }

      setProgress('Repository cloned successfully');
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (result.projectPath) {
        onSuccess(result.projectPath);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clone repository');
      setProgress('');
    } finally {
      setIsCloning(false);
    }
  }, [owner, repo, repoUrl, onSuccess, onClose]);

  const handleCopyLink = useCallback(() => {
    const quickLink = `emdash.github.com/${owner}/${repo}`;
    window.electronAPI.clipboardWriteText(quickLink);
  }, [owner, repo]);

  return (
    <DialogContent
      className="max-w-md"
      onInteractOutside={(e) => {
        if (isCloning) e.preventDefault();
      }}
      onEscapeKeyDown={(e) => {
        if (isCloning) e.preventDefault();
      }}
    >
      <DialogHeader>
        <DialogTitle>Open GitHub Repository</DialogTitle>
      </DialogHeader>
      <Separator />

      <div className="space-y-4">
        <div className="rounded-md bg-muted/50 p-4">
          <p className="text-sm font-medium">
            {owner}/{repo}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{repoUrl}</p>
        </div>

        {isCloning && progress ? (
          <div className="flex items-center gap-3">
            <Spinner size="sm" />
            <div>
              <p className="text-sm font-medium">{progress}</p>
              <p className="text-xs text-muted-foreground">This may take a few moments...</p>
            </div>
          </div>
        ) : null}

        {error && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
        )}

        <div className="flex flex-col gap-2">
          <Button onClick={handleClone} disabled={isCloning}>
            {isCloning ? (
              <>
                <Spinner size="sm" className="mr-2" />
                Cloning...
              </>
            ) : (
              'Open in Emdash'
            )}
          </Button>
          <Button variant="outline" onClick={handleCopyLink} disabled={isCloning}>
            Copy Quick Link
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={isCloning}>
            Cancel
          </Button>
        </div>
      </div>
    </DialogContent>
  );
};
