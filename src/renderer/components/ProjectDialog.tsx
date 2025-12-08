import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Spinner } from './ui/spinner';
import { X, FolderOpen, Github, Home } from 'lucide-react';
import { useToast } from '../hooks/use-toast';

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
  const [cloneDestination, setCloneDestination] = useState<string>('');

  const { toast } = useToast();
  const shouldReduceMotion = useReducedMotion();

  // Set default clone destination on mount
  useEffect(() => {
    if (isOpen) {
      setCloneDestination('/Users/knewton26/Emdash');
    }
  }, [isOpen]);

  const handleOpenLocal = async () => {
    try {
      const result = await window.electronAPI.openProject();
      if (result.success && result.path) {
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

  const handleCloneGitHub = async (repoUrl: string, repoName?: string) => {
    try {
      setIsCloning(true);
      const result = await window.electronAPI.cloneProject(repoUrl, repoName, cloneDestination);
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
        setCloneDestination(result.path);
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
    if (!githubUrl.trim()) {
      toast({
        title: "Invalid URL",
        description: "Please enter a valid GitHub repository URL",
        variant: "destructive",
      });
      return;
    }

    // Basic GitHub URL validation
    const githubUrlPattern = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(\.git)?$/;
    if (!githubUrlPattern.test(githubUrl.trim())) {
      toast({
        title: "Invalid GitHub URL",
        description: "Please enter a valid GitHub repository URL (e.g., https://github.com/user/repo)",
        variant: "destructive",
      });
      return;
    }

    await handleCloneGitHub(githubUrl.trim());
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
                        placeholder="https://github.com/user/repo"
                        className="w-full"
                      />
                    </div>

                    {/* Clone Destination */}
                    <div>
                      <Label htmlFor="clone-destination" className="block mb-2">
                        Clone Destination
                      </Label>
                      <div className="flex items-center gap-2 p-3 border rounded-lg bg-muted/30">
                        <Home className="h-4 w-4 text-muted-foreground" />
                        <span className="flex-1 text-sm">{cloneDestination}</span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleChangeDestination}
                          className="shrink-0"
                        >
                          Change
                        </Button>
                      </div>
                    </div>

                    <div className="flex justify-end">
                      <Button
                        onClick={handleCustomUrlClone}
                        disabled={isCloning || !githubUrl.trim()}
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
