import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
import { Spinner } from './ui/spinner';
import { X, FolderOpen, Github } from 'lucide-react';
import { Separator } from './ui/separator';

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
  const shouldReduceMotion = useReducedMotion();
  const [defaultBasePath, setDefaultBasePath] = useState<string>('');

  useEffect(() => {
    const loadDefaultPath = async () => {
      try {
        const documentsPath = await window.electronAPI.getPath('documents');
        if (documentsPath) {
          // Default to ~/Documents/GitHub if possible, or just Documents
          const isWin = (await window.electronAPI.getPlatform()) === 'win32';
          const sep = isWin ? '\\' : '/';
          setDefaultBasePath(`${documentsPath}${sep}GitHub`);
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
    }
  }, [isOpen]);

  // Auto-populate destination when URL changes
  useEffect(() => {
    if (!repoUrl || !defaultBasePath) return;
    
    // Extract repo name from URL
    // e.g. https://github.com/owner/repo.git -> repo
    try {
      const match = repoUrl.match(/\/([^/]+?)(\.git)?$/);
      if (match && match[1]) {
        const repoName = match[1];
        // Only update if destination is empty or looks like an auto-generated path
        const isWin = destinationPath.includes('\\');
        const sep = isWin ? '\\' : '/';
        
        if (!destinationPath || destinationPath.startsWith(defaultBasePath)) {
           setDestinationPath(`${defaultBasePath}${sep}${repoName}`);
        }
      }
    } catch {}
  }, [repoUrl, defaultBasePath]);

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
        setDestinationPath(selectedPath);
      }
    } catch (err) {
      console.error('Failed to open directory dialog', err);
    }
  };

  const validate = (): string | null => {
    if (!repoUrl.trim()) return 'Please enter a repository URL.';
    if (!destinationPath.trim()) return 'Please enter a destination path.';
    return null;
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

    try {
      await onClone(repoUrl, destinationPath);
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
                      className="block text-sm font-medium text-foreground mb-1.5"
                    >
                      Repository URL
                    </label>
                    <Input
                      id="repo-url"
                      value={repoUrl}
                      onChange={(e) => {
                        setRepoUrl(e.target.value);
                        if (touched) setError(validate());
                      }}
                      onBlur={() => setTouched(true)}
                      placeholder="https://github.com/username/repo.git"
                      className="w-full"
                      autoFocus
                    />
                    <p className="text-[11px] text-muted-foreground mt-1.5">
                      Supports URLs with or without .git extension
                    </p>
                  </div>

                  <div>
                    <label
                      htmlFor="destination-path"
                      className="block text-sm font-medium text-foreground mb-1.5"
                    >
                      Destination Path
                    </label>
                    <div className="flex gap-2">
                      <Input
                        id="destination-path"
                        value={destinationPath}
                        onChange={(e) => {
                          setDestinationPath(e.target.value);
                          if (touched) setError(validate());
                        }}
                        placeholder="/path/to/destination"
                        className="flex-1"
                      />
                      <Button type="button" variant="outline" onClick={handleBrowse} title="Browse">
                        <FolderOpen className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  {error && (
                    <p className="text-sm text-destructive bg-destructive/10 p-2 rounded-md">
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
