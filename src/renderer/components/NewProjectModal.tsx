import React, { useCallback, useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Spinner } from './ui/spinner';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './ui/accordion';
import { X, Settings } from 'lucide-react';
import { Separator } from './ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';

interface NewProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (projectPath: string) => void;
}

interface Owner {
  login: string;
  type: 'User' | 'Organization';
}

export const NewProjectModal: React.FC<NewProjectModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [repoName, setRepoName] = useState('');
  const [description, setDescription] = useState('');
  const [owner, setOwner] = useState<string>('');
  const [owners, setOwners] = useState<Owner[]>([]);
  const [isPrivate, setIsPrivate] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [progress, setProgress] = useState<string>('');
  const [touched, setTouched] = useState(false);
  const shouldReduceMotion = useReducedMotion();
  const validationTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Load owners on mount
  useEffect(() => {
    if (!isOpen) return;

    let cancel = false;
    (async () => {
      try {
        const result = await window.electronAPI.githubGetOwners();
        if (cancel) return;
        if (result.success && result.owners) {
          setOwners(result.owners);
          // Set default owner to current user
          const user = result.owners.find((o) => o.type === 'User');
          if (user) {
            setOwner(user.login);
          }
        }
      } catch (error) {
        console.error('Failed to load owners:', error);
      }
    })();

    return () => {
      cancel = true;
    };
  }, [isOpen]);

  // Reset form on open
  useEffect(() => {
    if (!isOpen) return;

    setRepoName('');
    setDescription('');
    setIsPrivate(false);
    setError(null);
    setValidationError(null);
    setIsValidating(false);
    setProgress('');
    setTouched(false);
    setShowAdvanced(false);
  }, [isOpen]);

  // Validate repository name
  useEffect(() => {
    if (!repoName.trim() || !owner) {
      setValidationError(null);
      return;
    }

    // Clear existing timeout
    if (validationTimeoutRef.current) {
      clearTimeout(validationTimeoutRef.current);
    }

    setIsValidating(true);
    validationTimeoutRef.current = setTimeout(async () => {
      try {
        const result = await window.electronAPI.githubValidateRepoName(repoName.trim(), owner);
        setIsValidating(false);
        if (!result.success || !result.valid) {
          setValidationError(result.error || 'Invalid repository name');
        } else if (result.exists) {
          setValidationError(`Repository ${owner}/${repoName.trim()} already exists`);
        } else {
          setValidationError(null);
        }
      } catch (error) {
        setIsValidating(false);
        setValidationError(null); // Don't block on validation errors
      }
    }, 500); // Debounce 500ms

    return () => {
      if (validationTimeoutRef.current) {
        clearTimeout(validationTimeoutRef.current);
      }
    };
  }, [repoName, owner]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setTouched(true);
      setError(null);

      if (!repoName.trim()) {
        setError('Repository name is required');
        return;
      }

      if (validationError) {
        setError(validationError);
        return;
      }

      if (!owner) {
        setError('Please select an owner');
        return;
      }

      setIsCreating(true);
      setProgress('Creating repository on GitHub...');

      try {
        const result = await window.electronAPI.githubCreateNewProject({
          name: repoName.trim(),
          description: description.trim() || undefined,
          owner,
          isPrivate,
        });

        if (result.success && result.projectPath) {
          setProgress('');
          onSuccess(result.projectPath);
          onClose();
        } else {
          let errorMessage = result.error || 'Failed to create project';
          if (result.githubRepoCreated && result.repoUrl) {
            errorMessage += `\n\nNote: The GitHub repository was created but setup failed. You can clone it manually: ${result.repoUrl}`;
          }
          setError(errorMessage);
          setProgress('');
        }
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Failed to create project');
        setProgress('');
      } finally {
        setIsCreating(false);
      }
    },
    [repoName, description, owner, isPrivate, validationError, onSuccess, onClose]
  );

  const repoFullPath = owner && repoName.trim() ? `${owner}/${repoName.trim()}` : '';

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
            <Card className="relative max-h-[calc(100vh-48px)] w-full overflow-y-auto">
              <Button
                variant="ghost"
                size="sm"
                onClick={onClose}
                className="absolute right-2 top-2 z-10 h-8 w-8 p-0"
                disabled={isCreating}
              >
                <X className="h-4 w-4" />
              </Button>
              <CardHeader className="space-y-1 pb-2 pr-12">
                <CardTitle className="text-lg">New Project</CardTitle>
                <CardDescription className="text-xs text-muted-foreground">
                  Create a new GitHub repository and get started
                </CardDescription>
              </CardHeader>

              <CardContent>
                <Separator className="mb-2" />
                {isCreating && progress ? (
                  <div className="space-y-4 py-4">
                    <div className="flex items-center gap-3">
                      <Spinner size="sm" />
                      <div className="flex-1">
                        <p className="text-sm font-medium">{progress}</p>
                        <p className="text-xs text-muted-foreground">
                          This may take a few seconds...
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                      <Label htmlFor="repo-name" className="mb-2 block">
                        Repository name *
                      </Label>
                      <Input
                        id="repo-name"
                        value={repoName}
                        onChange={(e) => setRepoName(e.target.value)}
                        onBlur={() => setTouched(true)}
                        placeholder="my-awesome-project"
                        className={`w-full ${
                          touched && (error || validationError)
                            ? 'border-destructive focus-visible:border-destructive focus-visible:ring-destructive'
                            : ''
                        }`}
                        aria-invalid={touched && !!(error || validationError)}
                        disabled={isCreating}
                        autoFocus
                      />
                      {repoFullPath && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Will create: <span className="font-mono">{repoFullPath}</span>
                        </p>
                      )}
                      {touched && (validationError || error) && (
                        <p className="mt-1 text-xs text-destructive">
                          {validationError || error}
                        </p>
                      )}
                      {isValidating && (
                        <p className="mt-1 text-xs text-muted-foreground">Validating...</p>
                      )}
                    </div>

                    <div>
                      <Label htmlFor="description" className="mb-2 block">
                        Description
                      </Label>
                      <Input
                        id="description"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="A brief description of your project"
                        disabled={isCreating}
                      />
                    </div>

                    <div>
                      <Label htmlFor="owner" className="mb-2 block">
                        Owner *
                      </Label>
                      <Select value={owner} onValueChange={setOwner} disabled={isCreating}>
                        <SelectTrigger id="owner">
                          <SelectValue placeholder="Select owner" />
                        </SelectTrigger>
                        <SelectContent>
                          {owners.map((o) => (
                            <SelectItem key={o.login} value={o.login}>
                              {o.login} ({o.type === 'User' ? 'User' : 'Organization'})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label className="mb-2 block">Visibility</Label>
                      <div className="space-y-2">
                        <label className="flex items-center space-x-2 cursor-pointer">
                          <input
                            type="radio"
                            name="visibility"
                            value="public"
                            checked={!isPrivate}
                            onChange={(e) => setIsPrivate(e.target.value === 'private')}
                            disabled={isCreating}
                            className="h-4 w-4 text-primary focus:ring-primary border-gray-300"
                          />
                          <span className="text-sm">Public</span>
                        </label>
                        <label className="flex items-center space-x-2 cursor-pointer">
                          <input
                            type="radio"
                            name="visibility"
                            value="private"
                            checked={isPrivate}
                            onChange={(e) => setIsPrivate(e.target.value === 'private')}
                            disabled={isCreating}
                            className="h-4 w-4 text-primary focus:ring-primary border-gray-300"
                          />
                          <span className="text-sm">Private</span>
                        </label>
                      </div>
                    </div>

                    <Accordion
                      type="single"
                      collapsible
                      value={showAdvanced ? 'advanced' : undefined}
                      className="space-y-2"
                    >
                      <AccordionItem value="advanced" className="border-none">
                        <AccordionTrigger
                          className="flex h-9 w-full items-center justify-between whitespace-nowrap rounded-md border-none bg-gray-100 px-3 text-sm font-medium text-foreground hover:bg-gray-200 hover:no-underline dark:bg-gray-700 dark:hover:bg-gray-600 [&>svg]:h-4 [&>svg]:w-4 [&>svg]:shrink-0"
                          onPointerDown={(e) => {
                            e.preventDefault();
                            setShowAdvanced((prev) => !prev);
                          }}
                        >
                          <span className="inline-flex items-center gap-2">
                            <Settings className="h-4 w-4 text-muted-foreground" />
                            <span>Advanced options</span>
                          </span>
                        </AccordionTrigger>
                        <AccordionContent className="space-y-4 px-0 pt-2">
                          <div className="flex flex-col gap-4 p-2">
                            <p className="text-sm text-muted-foreground">
                              Additional options coming soon (templates, .gitignore, license)
                            </p>
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>

                    {error && !validationError && (
                      <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                        {error.split('\n').map((line, i) => (
                          <p key={i}>{line}</p>
                        ))}
                      </div>
                    )}

                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={onClose}
                        disabled={isCreating}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="submit"
                        disabled={
                          !!validationError ||
                          !repoName.trim() ||
                          !owner ||
                          isCreating ||
                          isValidating
                        }
                      >
                        {isCreating ? (
                          <>
                            <Spinner size="sm" className="mr-2" />
                            Creating...
                          </>
                        ) : (
                          'Create Project'
                        )}
                      </Button>
                    </div>
                  </form>
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

