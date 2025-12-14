import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
import { Spinner } from './ui/spinner';
import { X, FolderOpen, Github, Edit2 } from 'lucide-react';
import { Separator } from './ui/separator';
import {
  joinPath,
  parseGitHubRepoUrl,
  stripTrailingSeparators,
} from '../lib/projectCloneDestination';

interface CloneRepoModalProps {
  isOpen: boolean;
  onClose: () => void;
  onClone: (repoUrl: string, destinationPath: string) => Promise<void>;
}

const CloneRepoModal: React.FC<CloneRepoModalProps> = ({ isOpen, onClose, onClone }) => {
  const [repoUrl, setRepoUrl] = useState('');
  const [destinationPath, setDestinationPath] = useState('');
  const [isCloning, setIsCloning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [isEditingPath, setIsEditingPath] = useState(false);
  const shouldReduceMotion = useReducedMotion();
  const [defaultBasePath, setDefaultBasePath] = useState<string>('');
  const previousIsOpen = useRef(false);
  useEffect(() => {
    const loadDefaultPath = async () => {
      try {
        const homePath = await window.electronAPI.getPath('home');
        if (homePath) {
          // Default to ~/Emdash
          const isWin = (await window.electronAPI.getPlatform()) === 'win32';
          const sep = isWin ? '\\' : '/';
          setDefaultBasePath(joinPath(homePath, 'Emdash', sep));
        }
      } catch (err) {
        console.error('Failed to get default path', err);
      }
    };
    loadDefaultPath();
  }, []);

  useEffect(() => {
    if (!isOpen) {
      setRepoUrl('');
      setDestinationPath('');
      setError(null);
      setTouched(false);
      setIsCloning(false);
      setIsEditingPath(false);
    }
  }, [isOpen]);

  // Auto-populate destination when URL changes
  useEffect(() => {
    if (!repoUrl.trim() || !defaultBasePath) return;

    const parsed = parseGitHubRepoUrl(repoUrl.trim());
    if (!parsed) return;

    const repoName = parsed.repo;
    const isWin = destinationPath.includes('\\');
    const sep = isWin ? '\\' : '/';
    const base = stripTrailingSeparators(defaultBasePath);
    const trimmedDestination = stripTrailingSeparators(destinationPath);

    const shouldAutoFill = !trimmedDestination || (base && trimmedDestination.startsWith(base));

    if (shouldAutoFill && base) {
      setDestinationPath(joinPath(base, repoName, sep));
    }
  }, [repoUrl, defaultBasePath, destinationPath]);

  // Update destinationPath with defaultBasePath if it's empty and defaultBasePath is loaded
  useEffect(() => {
    if (defaultBasePath && !destinationPath) {
      setDestinationPath(stripTrailingSeparators(defaultBasePath));
    }
  }, [defaultBasePath, destinationPath]);

  // Ensure default path is restored when the modal first opens
  useEffect(() => {
    if (isOpen && !previousIsOpen.current && defaultBasePath && !destinationPath) {
      setDestinationPath(stripTrailingSeparators(defaultBasePath));
    }
    previousIsOpen.current = isOpen;
  }, [isOpen, defaultBasePath, destinationPath]);

  const validate = useCallback((): string | null => {
    const trimmedUrl = repoUrl.trim();
    if (!trimmedUrl) return 'Please enter a repository URL.';
    if (!parseGitHubRepoUrl(trimmedUrl)) return 'Please enter a valid GitHub repository URL.';
    if (!destinationPath.trim()) return 'Please enter a destination path.';
    return null;
  }, [repoUrl, destinationPath]);

  // Keep validation errors in sync once the user has interacted
  useEffect(() => {
    if (touched) {
      setError(validate());
    }
  }, [repoUrl, destinationPath, touched, validate]);

  const applyDefaultIfEmpty = () => {
    if (!destinationPath.trim() && defaultBasePath) {
      setDestinationPath(stripTrailingSeparators(defaultBasePath));
    }
  };

  const exitEditingPath = () => {
    setIsEditingPath(false);
    applyDefaultIfEmpty();
  };

  const handleBrowse = async () => {
    try {
      const result = await window.electronAPI.showOpenDialog({
        properties: ['openDirectory', 'createDirectory'],
        title: 'Select Destination Folder',
        defaultPath: defaultBasePath,
      });

      if (!result.canceled && result.filePaths.length > 0) {
        const selectedPath = result.filePaths[0];
        // If the selected path doesn't end with the repo name, append it?
        // Actually, standard behavior is usually "select parent folder", but users might select the *target* folder.
        // Let's assume user selects the PARENT folder, so we append repo name.
        // BUT, showOpenDialog with 'createDirectory' allows them to create the target folder.
        // Let's just set it to what they picked. If they picked "GitHub", they probably want to append the repo name.
        // To be safe, let's just set it to what they picked and let them edit if needed.
        setDestinationPath(stripTrailingSeparators(selectedPath));
      }
    } catch (err) {
      console.error('Failed to open directory dialog', err);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    const err = validate();
    if (err) {
      setError(err);
      return;
    }

    setIsCloning(true);
    setError(null);

    const trimmedUrl = repoUrl.trim();
    const parsedUrl = parseGitHubRepoUrl(trimmedUrl);
    if (!parsedUrl) {
      setError('Please enter a valid GitHub repository URL.');
      setIsCloning(false);
      return;
    }

    const isHttp = /^https?:\/\//i.test(trimmedUrl);
    const normalizedUrl = isHttp ? parsedUrl.normalizedUrl : trimmedUrl.replace(/\/+$/, '');
    if (isHttp && normalizedUrl !== trimmedUrl) {
      setRepoUrl(normalizedUrl);
    }

    const resolvedDestination =
      destinationPath.trim() || (defaultBasePath ? stripTrailingSeparators(defaultBasePath) : '');

    try {
      await onClone(normalizedUrl, stripTrailingSeparators(resolvedDestination));
      onClose();
    } catch (error: any) {
      setError(error.message || 'Failed to clone repository.');
    } finally {
      setIsCloning(false);
    }
  };

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          initial={shouldReduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={shouldReduceMotion ? { opacity: 1 } : { opacity: 0 }}
          transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.1, ease: 'easeOut' }}
          onClick={onClose}
        >
          <motion.div
            onClick={(e) => e.stopPropagation()}
            initial={shouldReduceMotion ? false : { opacity: 0, y: 8, scale: 0.995 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={
              shouldReduceMotion
                ? { opacity: 1, y: 0, scale: 1 }
                : { opacity: 0, y: 6, scale: 0.995 }
            }
            transition={
              shouldReduceMotion ? { duration: 0 } : { duration: 0.2, ease: [0.22, 1, 0.36, 1] }
            }
            className="mx-4 w-full max-w-md transform-gpu will-change-transform"
          >
            <Card className="relative w-full">
              <Button
                variant="ghost"
                size="sm"
                onClick={onClose}
                className="absolute right-2 top-2 z-10 h-8 w-8 p-0"
              >
                <X className="h-4 w-4" />
              </Button>
              <CardHeader className="space-y-1 pb-2 pr-12">
                <div className="flex items-center gap-2">
                  <Github className="h-5 w-5" />
                  <CardTitle className="text-lg">Clone from GitHub</CardTitle>
                </div>
                <CardDescription className="text-xs text-muted-foreground">
                  Clone a Git repository to your local machine
                </CardDescription>
              </CardHeader>

              <CardContent>
                <Separator className="mb-4" />
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label
                      htmlFor="repo-url"
                      className="mb-1.5 block text-sm font-medium text-foreground"
                    >
                      Repository URL
                    </label>
                    <Input
                      id="repo-url"
                      value={repoUrl}
                      onChange={(e) => {
                        setRepoUrl(e.target.value);
                        setError(null);
                      }}
                      onBlur={() => setTouched(true)}
                      placeholder="https://github.com/username/repo.git"
                      className="w-full"
                      autoFocus
                    />
                    <p className="mt-1.5 text-[11px] text-muted-foreground">
                      Supports URLs with or without .git extension
                    </p>
                  </div>

                  <div>
                    <label
                      htmlFor="destination-path"
                      className="mb-1.5 block text-sm font-medium text-foreground"
                    >
                      Destination Path
                    </label>
                    <div className="flex flex-col gap-2">
                      {isEditingPath ? (
                        <div
                          className="flex gap-2"
                          onBlur={(e) => {
                            const relatedTarget = e.relatedTarget as Node | null;
                            if (!relatedTarget || !e.currentTarget.contains(relatedTarget)) {
                              exitEditingPath();
                            }
                          }}
                        >
                          <Input
                            id="destination-path"
                            value={destinationPath}
                            onChange={(e) => {
                              setDestinationPath(e.target.value);
                              setError(null);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                exitEditingPath();
                              }
                            }}
                            placeholder="/path/to/destination"
                            className="flex-1"
                            autoFocus
                          />
                          <Button
                            type="button"
                            variant="outline"
                            onClick={handleBrowse}
                            title="Browse"
                          >
                            <FolderOpen className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="flex w-full items-center justify-between rounded-md border border-input bg-muted/50 px-3 py-2 text-sm transition-colors hover:bg-muted/70"
                          onClick={() => setIsEditingPath(true)}
                          title="Edit destination path"
                        >
                          <span className="truncate text-left font-mono text-muted-foreground">
                            {destinationPath || 'No path selected'}
                          </span>
                          <Edit2 className="ml-2 h-3.5 w-3.5 flex-shrink-0 text-muted-foreground opacity-70" />
                        </button>
                      )}
                    </div>
                  </div>

                  {error && (
                    <p className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">
                      {error}
                    </p>
                  )}

                  <div className="flex justify-end pt-2">
                    <Button type="submit" disabled={isCloning || !repoUrl || !destinationPath}>
                      {isCloning ? (
                        <>
                          <Spinner size="sm" className="mr-2" />
                          Cloning...
                        </>
                      ) : (
                        'Clone'
                      )}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
};

export default CloneRepoModal;
