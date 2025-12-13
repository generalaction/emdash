import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Spinner } from './ui/spinner';
import { X, FolderOpen, Github } from 'lucide-react';
import { useToast } from '../hooks/use-toast';
import {
  computeNextCloneDestination,
  deriveCloneProjectArgs,
  joinPath,
  parseGitHubRepoUrl,
  splitPathForDisplay,
  stripTrailingSeparators,
} from '../lib/projectCloneDestination';

interface ProjectDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onProjectAdded: (path: string) => void;
}

const ProjectDialog: React.FC<ProjectDialogProps> = ({
  isOpen,
  onClose,
  onProjectAdded,
}) => {
  const [mode, setMode] = useState<'local' | 'github'>('local');
  const [localPath, setLocalPath] = useState('');
  const [githubUrl, setGithubUrl] = useState('');
  const [isCloning, setIsCloning] = useState(false);
  const [cloneBasePath, setCloneBasePath] = useState<string>('');
  const [repoSegment, setRepoSegment] = useState('');
  const [repoSegmentTouched, setRepoSegmentTouched] = useState(false);
  const [pathSeparator, setPathSeparator] = useState<'/' | '\\'>('/');
  const [lastAutoRepoName, setLastAutoRepoName] = useState<string | null>(null);
  const [repoExists, setRepoExists] = useState(false);
  const [repoCheckError, setRepoCheckError] = useState<string | null>(null);
  const openSessionIdRef = useRef(0);

  const { toast } = useToast();
  const shouldReduceMotion = useReducedMotion();
  const baseDisplayPath = cloneBasePath
    ? `${stripTrailingSeparators(cloneBasePath)}${pathSeparator}`
    : '/path/to/Emdash/';
  const trimmedRepoSegment = repoSegment.trim();
  const targetDestinationPath =
    trimmedRepoSegment && cloneBasePath
      ? joinPath(cloneBasePath, trimmedRepoSegment, pathSeparator)
      : '';

  // Set default clone destination on open
  useEffect(() => {
    if (!isOpen) return;

    openSessionIdRef.current += 1;
    const sessionId = openSessionIdRef.current;

    setRepoSegmentTouched(false);
    setLastAutoRepoName(null);
    setCloneBasePath('');
    setRepoSegment('');
    setRepoExists(false);
    setRepoCheckError(null);

    let cancelled = false;
    (async () => {
      try {
        const [homePath, platform] = await Promise.all([
          window.electronAPI.getPath('home'),
          window.electronAPI.getPlatform(),
        ]);
        if (cancelled || openSessionIdRef.current !== sessionId) return;
        const sep = platform === 'win32' ? '\\' : '/';
        setPathSeparator(sep);
        const basePath = homePath ? joinPath(homePath, 'Emdash', sep) : '';
        setCloneBasePath(basePath);
        setRepoSegment('');
        setRepoSegmentTouched(false);
      } catch (error) {
        console.error('Failed to set default clone destination:', error);
        setCloneBasePath('');
        setRepoSegment('');
        setRepoSegmentTouched(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  // Auto-populate destination with repo name when URL changes
  useEffect(() => {
    if (!isOpen) return;
    if (!githubUrl.trim()) return;

    const parsedRepo = parseGitHubRepoUrl(githubUrl.trim());
    const repoName = parsedRepo?.repo;
    if (!repoName) return;

    const currentDestination = joinPath(cloneBasePath, repoSegment, pathSeparator);

    const { shouldUpdate, nextDestination, nextLastAutoRepoName } = computeNextCloneDestination({
      currentDestination,
      defaultBasePath: cloneBasePath,
      repoName,
      sep: pathSeparator,
      destinationTouched: repoSegmentTouched,
      lastAutoRepoName,
    });

    if (!shouldUpdate || !nextDestination) return;

    const { prefix, name } = splitPathForDisplay(nextDestination);
    setCloneBasePath(stripTrailingSeparators(prefix));
    setRepoSegment(name);

    if (nextLastAutoRepoName !== lastAutoRepoName) {
      setLastAutoRepoName(nextLastAutoRepoName);
    }
    setRepoSegmentTouched(false);
  }, [
    isOpen,
    githubUrl,
    cloneBasePath,
    repoSegment,
    pathSeparator,
    repoSegmentTouched,
    lastAutoRepoName,
  ]);

  useEffect(() => {
    if (!targetDestinationPath) {
      setRepoExists(false);
      setRepoCheckError(null);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const { exists, error } = await window.electronAPI.pathExists(targetDestinationPath);
        if (cancelled) return;
        if (error) {
          setRepoExists(false);
          setRepoCheckError('Unable to verify destination path');
          return;
        }
        setRepoExists(exists);
        if (!exists) setRepoCheckError(null);
      } catch (error) {
        if (cancelled) return;
        setRepoExists(false);
        setRepoCheckError('Unable to verify destination path');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [targetDestinationPath]);

  const handleOpenLocal = async () => {
    try {
      const result = await window.electronAPI.openProject();
      if (result.success && result.path) {
        setLocalPath(result.path);
        onProjectAdded(result.path);
        onClose();
        toast({
          title: "Project added",
          description: "Local project opened successfully",
        });
      } else {
        toast({
          title: "Failed to open project",
          description: result.error || "No directory selected",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error('Failed to open local project:', error);
      toast({
        title: "Failed to open project",
        description: "An unexpected error occurred",
        variant: "destructive",
      });
    }
  };

  const handleCloneGitHub = async (repoUrl: string) => {
    try {
      setIsCloning(true);
      const currentDestination = joinPath(cloneBasePath, repoSegment, pathSeparator);
      const parsedRepo = parseGitHubRepoUrl(repoUrl.trim());
      const repoNameFromUrl = parsedRepo?.repo ?? null;
      const { parentDir, repoName } = deriveCloneProjectArgs({
        destinationPath: currentDestination,
        defaultBasePath: cloneBasePath,
        repoNameFromUrl,
      });

      const result = await window.electronAPI.cloneProject(
        repoUrl,
        repoName,
        parentDir
      );
      if (result.success && result.path) {
        onProjectAdded(result.path);
        onClose();
        toast({
          title: "Repository cloned successfully",
          description: `GitHub repository cloned to ${result.path}`,
        });
      } else {
        toast({
          title: "Failed to clone repository",
          description: result.error || "Clone operation failed",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error('Failed to clone repository:', error);
      toast({
        title: "Failed to clone repository",
        description: "An unexpected error occurred",
        variant: "destructive",
      });
    } finally {
      setIsCloning(false);
    }
  };

  const handleChangeDestination = async () => {
    try {
      const result = await window.electronAPI.selectCloneDestination();
      if (result.success && result.path) {
        const parsedRepo = parseGitHubRepoUrl(githubUrl.trim());
        const repoNameFromUrl = parsedRepo?.repo ?? null;
        setCloneBasePath(result.path);

        if (!repoSegment.trim() && repoNameFromUrl) {
          setRepoSegment(repoNameFromUrl);
          setLastAutoRepoName(repoNameFromUrl);
          setRepoSegmentTouched(false);
        } else {
          setRepoSegmentTouched(true);
        }

        const sep = result.path.includes('\\') ? '\\' : result.path.includes('/') ? '/' : pathSeparator;
        setPathSeparator(sep);
      }
    } catch (error) {
      console.error('Failed to select clone destination:', error);
      toast({
        title: "Failed to change destination",
        description: "Could not select directory",
        variant: "destructive",
      });
    }
  };

  const handleCustomUrlClone = async () => {
    const trimmedUrl = githubUrl.trim();
    if (!trimmedUrl) {
      toast({
        title: "Invalid URL",
        description: "Please enter a valid GitHub repository URL",
        variant: "destructive",
      });
      return;
    }

    const parsedRepo = parseGitHubRepoUrl(trimmedUrl);
    if (!parsedRepo) {
      toast({
        title: "Invalid GitHub URL",
        description:
          "Please enter a valid GitHub repository URL (e.g., https://github.com/user/repo or git@github.com:user/repo.git)",
        variant: "destructive",
      });
      return;
    }

    const isHttp = /^https?:\/\//i.test(trimmedUrl);
    const cloneUrl = isHttp ? parsedRepo.normalizedUrl : trimmedUrl.replace(/\/+$/, '');
    if (isHttp && cloneUrl !== trimmedUrl) setGithubUrl(cloneUrl);

    await handleCloneGitHub(cloneUrl);
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
            className="mx-4 w-full max-w-2xl max-h-[calc(100vh-48px)] transform-gpu will-change-transform overflow-hidden"
          >
            <Card className="relative max-h-full overflow-y-auto">
              <Button
                variant="ghost"
                size="sm"
                onClick={onClose}
                className="absolute right-2 top-2 z-10 h-8 w-8 p-0"
              >
                <X className="h-4 w-4" />
              </Button>
              <CardHeader className="space-y-1 pb-4 pr-12">
                <CardTitle className="text-lg">Add Project</CardTitle>
                <CardDescription className="text-sm">
                  Open a local directory or clone a GitHub repository
                </CardDescription>
              </CardHeader>

              <CardContent className="space-y-6">
                {/* Mode Selection */}
                <div className="flex gap-2">
                  <Button
                    variant={mode === 'local' ? 'default' : 'outline'}
                    onClick={() => setMode('local')}
                    className="flex-1"
                  >
                    <FolderOpen className="mr-2 h-4 w-4" />
                    Local Directory
                  </Button>
                  <Button
                    variant={mode === 'github' ? 'default' : 'outline'}
                    onClick={() => setMode('github')}
                    className="flex-1"
                  >
                    <Github className="mr-2 h-4 w-4" />
                    GitHub Repository
                  </Button>
                </div>

                {mode === 'local' ? (
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="local-path" className="block mb-2">
                        Open Local Project
                      </Label>
                      <div className="flex gap-2">
                        <Input
                          id="local-path"
                          value={localPath}
                          onChange={(e) => setLocalPath(e.target.value)}
                          placeholder="Select a directory..."
                          readOnly
                          className="flex-1"
                        />
                        <Button onClick={handleOpenLocal}>
                          Browse...
                        </Button>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">
                        Select an existing project directory from your local file system
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* GitHub URL Input */}
                    <div>
                      <Label htmlFor="github-url" className="block mb-2">
                        GitHub Repository URL
                      </Label>
                      <Input
                        id="github-url"
                        value={githubUrl}
                        onChange={(e) => setGithubUrl(e.target.value)}
                        onBlur={() => {
                          const trimmedUrl = githubUrl.trim();
                          if (!trimmedUrl) return;

                          const isHttp = /^https?:\/\//i.test(trimmedUrl);
                          if (!isHttp) {
                            if (trimmedUrl !== githubUrl) setGithubUrl(trimmedUrl);
                            return;
                          }

                          const parsedRepo = parseGitHubRepoUrl(trimmedUrl);
                          if (!parsedRepo) {
                            if (trimmedUrl !== githubUrl) setGithubUrl(trimmedUrl);
                            return;
                          }

                          if (parsedRepo.normalizedUrl !== trimmedUrl) {
                            setGithubUrl(parsedRepo.normalizedUrl);
                          } else if (trimmedUrl !== githubUrl) {
                            setGithubUrl(trimmedUrl);
                          }
                        }}
                        placeholder="https://github.com/user/repo"
                        className="w-full"
                      />
                    </div>

                    {/* Clone Destination */}
                    <div>
                      <Label htmlFor="clone-destination" className="block mb-2">
                        Clone Destination
                      </Label>
                      <div className="flex gap-2">
                        <div className="flex items-stretch gap-0 rounded-md border border-input">
                          <span className="flex items-center px-3 text-sm font-mono font-normal text-muted-foreground bg-muted/30 border-r border-input/80">
                            {baseDisplayPath}
                          </span>
                          <Input
                            id="clone-repo-name"
                            value={repoSegment}
                            onChange={(e) => {
                              setRepoSegment(e.target.value);
                              setRepoSegmentTouched(true);
                            }}
                            onBlur={() => {
                              const trimmed = repoSegment.trim();
                              if (!trimmed) {
                                const parsedRepo = parseGitHubRepoUrl(githubUrl.trim());
                                const repoName = parsedRepo?.repo ?? lastAutoRepoName;
                                if (repoName) {
                                  setRepoSegment(repoName);
                                  setLastAutoRepoName(repoName);
                                  setRepoSegmentTouched(false);
                                }
                                return;
                              }
                              if (trimmed !== repoSegment) {
                                setRepoSegment(trimmed);
                              }
                            }}
                            placeholder="workspace-name"
                            className="w-full rounded-none font-mono"
                          />
                        </div>
                        <Button
                          variant="outline"
                          onClick={handleChangeDestination}
                          className="shrink-0 h-10"
                        >
                          <FolderOpen className="mr-2 h-4 w-4" />
                          Change
                        </Button>
                      </div>
                      {repoCheckError ? (
                        <p className="text-xs text-destructive mt-1">{repoCheckError}</p>
                      ) : repoExists && targetDestinationPath ? (
                        <p className="text-xs text-destructive mt-1">
                          A folder already exists at {targetDestinationPath}. Choose a different name or
                          remove that folder before cloning.
                        </p>
                      ) : null}
                    </div>

                    <div className="flex justify-end">
                      <Button
                        onClick={handleCustomUrlClone}
                        disabled={isCloning || !githubUrl.trim() || repoExists}
                        className="w-full sm:w-auto"
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
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
};

export default ProjectDialog;
