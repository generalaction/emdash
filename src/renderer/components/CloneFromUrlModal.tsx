import React, { useCallback, useEffect, useState } from 'react';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Spinner } from './ui/spinner';
import { Separator } from './ui/separator';

interface CloneFromUrlModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (projectPath: string) => void;
}

export const CloneFromUrlModal: React.FC<CloneFromUrlModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [repoUrl, setRepoUrl] = useState('');
  const [directoryName, setDirectoryName] = useState('');
  const [isCloning, setIsCloning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string>('');
  const [touched, setTouched] = useState(false);

  // Clean URL by removing hash, query params, and trailing slashes
  const cleanUrl = useCallback((url: string): string => {
    return url
      .trim()
      .replace(/#.*$/, '') // Remove hash/fragment
      .replace(/\?.*$/, '') // Remove query parameters
      .replace(/\/+$/, ''); // Remove trailing slashes
  }, []);

  // Parse repo name from URL for directory name suggestion
  useEffect(() => {
    if (!repoUrl.trim()) {
      setDirectoryName('');
      return;
    }

    try {
      const cleanedUrl = cleanUrl(repoUrl);
      // Try to extract repo name from various URL formats
      let repoName = '';

      // Handle https://github.com/owner/repo.git or https://github.com/owner/repo
      const httpsMatch = cleanedUrl.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
      if (httpsMatch) {
        repoName = httpsMatch[2];
      } else {
        // Handle git@github.com:owner/repo.git
        const sshMatch = cleanedUrl.match(/:([^/]+)\/([^/]+?)(?:\.git)?$/);
        if (sshMatch) {
          repoName = sshMatch[2];
        } else {
          // Handle ssh://git@host/path/to/repo.git
          const sshUrlMatch = cleanedUrl.match(/\/([^/]+?)(?:\.git)?\/?$/);
          if (sshUrlMatch) {
            repoName = sshUrlMatch[1];
          } else {
            // Fallback: take last segment after splitting by / or :
            const segments = cleanedUrl.split(/[/:]/).filter(Boolean);
            if (segments.length > 0) {
              repoName = segments[segments.length - 1].replace(/\.git$/, '');
            }
          }
        }
      }

      if (repoName && !directoryName) {
        setDirectoryName(repoName);
      }
    } catch (e) {
      // Ignore parsing errors
    }
  }, [repoUrl, directoryName, cleanUrl]);

  // Reset form on open
  useEffect(() => {
    if (!isOpen) return;

    setRepoUrl('');
    setDirectoryName('');
    setError(null);
    setProgress('');
    setTouched(false);
  }, [isOpen]);

  const validateUrl = (url: string): { valid: boolean; error?: string } => {
    const cleaned = cleanUrl(url);
    if (!cleaned) {
      return { valid: false, error: 'Repository URL is required' };
    }

    const trimmed = cleaned;

    // Check for common Git URL patterns
    const patterns = [
      /^https?:\/\/.+/i, // https:// or http://
      /^git@.+:.+/i, // git@host:path
      /^ssh:\/\/.+/i, // ssh://
    ];

    const isValid = patterns.some((pattern) => pattern.test(trimmed));
    if (!isValid) {
      return {
        valid: false,
        error: 'Please enter a valid Git URL (https://, git@, or ssh://)',
      };
    }

    return { valid: true };
  };

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setTouched(true);
      setError(null);

      const cleanedUrl = cleanUrl(repoUrl);
      const validation = validateUrl(cleanedUrl);
      if (!validation.valid) {
        setError(validation.error || 'Invalid URL');
        return;
      }

      if (!directoryName.trim()) {
        setError('Directory name is required');
        return;
      }

      setIsCloning(true);
      setProgress('Cloning repository...');

      try {
        // Get default directory from settings
        const settingsResult = await window.electronAPI.getSettings();
        const defaultDir =
          settingsResult.success && settingsResult.settings?.projects?.defaultDirectory
            ? settingsResult.settings.projects.defaultDirectory
            : '~/emdash-projects';
        const localPath = `${defaultDir}/${directoryName.trim()}`;

        setProgress(`Cloning to ${localPath}...`);

        const cloneResult = await window.electronAPI.githubCloneRepository(cleanedUrl, localPath);

        if (!cloneResult.success) {
          throw new Error(cloneResult.error || 'Failed to clone repository');
        }

        setProgress('Repository cloned successfully');
        await new Promise((resolve) => setTimeout(resolve, 500)); // Brief pause for UX

        onSuccess(localPath);
        onClose();
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to clone repository';
        setError(errorMessage);
        setProgress('');
      } finally {
        setIsCloning(false);
      }
    },
    [repoUrl, directoryName, onSuccess, onClose]
  );

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Clone from URL</DialogTitle>
        </DialogHeader>

        <Separator />

        {isCloning && progress ? (
          <div className="space-y-4 py-4">
            <div className="flex items-center gap-3">
              <Spinner size="sm" />
              <div className="flex-1">
                <p className="text-sm font-medium">{progress}</p>
                <p className="text-xs text-muted-foreground">This may take a few moments...</p>
              </div>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="mt-2">
              <Label htmlFor="repo-url" className="mb-2 block">
                Repository URL *
              </Label>
              <Input
                id="repo-url"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                onBlur={() => setTouched(true)}
                placeholder="https://github.com/owner/repo.git"
                className={`w-full ${
                  touched && error
                    ? 'border-destructive focus-visible:border-destructive focus-visible:ring-destructive'
                    : ''
                }`}
                aria-invalid={touched && !!error}
                disabled={isCloning}
                autoFocus
              />
              {touched && error && !repoUrl.trim() && (
                <p className="mt-1 text-xs text-destructive">{error}</p>
              )}
            </div>

            <div>
              <Label htmlFor="directory-name" className="mb-2 block">
                Directory name *
              </Label>
              <Input
                id="directory-name"
                value={directoryName}
                onChange={(e) => setDirectoryName(e.target.value)}
                placeholder="my-project"
                disabled={isCloning}
                className="w-full"
              />
              <p className="mt-1 pl-0.5 text-[10px] text-muted-foreground">
                Local directory name (auto-detected from URL)
              </p>
            </div>

            {error && repoUrl.trim() && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {error.split('\n').map((line, i) => (
                  <p key={i}>{line}</p>
                ))}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose} disabled={isCloning}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  !cleanUrl(repoUrl) ||
                  !directoryName.trim() ||
                  isCloning ||
                  (touched && !validateUrl(cleanUrl(repoUrl)).valid)
                }
              >
                {isCloning ? (
                  <>
                    <Spinner size="sm" className="mr-2" />
                    Cloning...
                  </>
                ) : (
                  'Clone Repository'
                )}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
};
