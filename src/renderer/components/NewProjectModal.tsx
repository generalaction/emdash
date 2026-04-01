import React, { useCallback, useEffect, useState, useRef } from 'react';
import { Button } from './ui/button';
import { DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';
import { SlugInput } from './ui/slug-input';
import { Label } from './ui/label';
import { RadioGroup, RadioGroupItem } from './ui/radio-group';
import { Spinner } from './ui/spinner';
import { Separator } from './ui/separator';

interface NewProjectModalProps {
  onClose: () => void;
  onSuccess: (projectPath: string) => void;
}

interface Owner {
  login: string;
  type: 'User' | 'Organization';
}

type TemplateType = 'blank' | 't3' | 'vite-react' | 'gStack';

interface TemplateOption {
  value: TemplateType;
  label: string;
  description: string;
  isNew?: boolean;
}

const TEMPLATE_OPTIONS: TemplateOption[] = [
  { value: 'blank', label: 'Blank', description: 'Start from scratch' },
  { value: 't3', label: 'T3 Stack', description: 'Full-stack T3 app' },
  { value: 'vite-react', label: 'Vite + React', description: 'Fast React setup with Vite' },
  { value: 'gStack', label: 'gStack', description: 'Garry Tan gstack starter repo', isNew: true },
];

export const NewProjectModal: React.FC<NewProjectModalProps> = ({ onClose, onSuccess }) => {
  const [repoName, setRepoName] = useState('');
  const [description, setDescription] = useState('');
  const [owner, setOwner] = useState<string>('');
  const [_owners, setOwners] = useState<Owner[]>([]);
  const [isPrivate, setIsPrivate] = useState(false);
  const [template, setTemplate] = useState<TemplateType>('blank');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [progress, setProgress] = useState<string>('');
  const [touched, setTouched] = useState(false);
  const validationTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Load owners on mount
  useEffect(() => {
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
  }, []);

  // Reset form on mount
  useEffect(() => {
    setRepoName('');
    setDescription('');
    setIsPrivate(false);
    setTemplate('blank');
    setError(null);
    setValidationError(null);
    setIsValidating(false);
    setProgress('');
    setTouched(false);
  }, []);

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
        setError('Unable to determine GitHub account. Please ensure you are authenticated.');
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
          template,
        });

        if (result.success && result.projectPath) {
          setProgress('Repository created successfully! Adding to workspace...');
          // Brief delay to show success message
          await new Promise((resolve) => setTimeout(resolve, 500));
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
    [repoName, description, owner, isPrivate, template, validationError, onSuccess, onClose]
  );

  return (
    <DialogContent
      className="max-w-md"
      onInteractOutside={(e) => {
        if (isCreating) e.preventDefault();
      }}
      onEscapeKeyDown={(e) => {
        if (isCreating) e.preventDefault();
      }}
    >
      <DialogHeader>
        <DialogTitle>New Project</DialogTitle>
      </DialogHeader>

      <Separator />

      {isCreating && progress ? (
        <div className="space-y-4 py-4">
          <div className="flex items-center gap-3">
            <Spinner size="sm" />
            <div className="flex-1">
              <p className="text-sm font-medium">{progress}</p>
              <p className="text-xs text-muted-foreground">This may take a few seconds...</p>
            </div>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label className="mb-2 block">Template</Label>
            <div className="grid grid-cols-3 gap-2">
              {TEMPLATE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setTemplate(option.value)}
                  className={`relative flex flex-col items-start rounded-lg border p-3 transition-all ${
                    template === option.value
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-muted-foreground'
                  }`}
                >
                  <span className="text-sm font-medium">{option.label}</span>
                  <span className="text-left text-xs text-muted-foreground">
                    {option.description}
                  </span>
                  {option.isNew && (
                    <span className="absolute right-2 top-2 rounded bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                      New
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label htmlFor="repo-name" className="mb-2 block">
              Repository name <span className="text-destructive">*</span>
            </Label>
            <SlugInput
              id="repo-name"
              value={repoName}
              onChange={setRepoName}
              onBlur={() => setTouched(true)}
              placeholder="my-awesome-project"
              maxLength={100}
              className={`w-full ${
                touched && (error || validationError)
                  ? 'border-destructive focus-visible:border-destructive focus-visible:ring-destructive'
                  : ''
              }`}
              aria-invalid={touched && !!(error || validationError)}
              disabled={isCreating}
              autoFocus
            />
            {touched && (validationError || error) && (
              <div className="mt-1">
                <p className="text-xs text-destructive">{validationError || error}</p>
              </div>
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
            <Label className="mb-2 block">Visibility</Label>
            <RadioGroup
              value={isPrivate ? 'private' : 'public'}
              onValueChange={(value: string) => setIsPrivate(value === 'private')}
              disabled={isCreating}
              className="flex items-center gap-4"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="public" id="visibility-public" />
                <Label htmlFor="visibility-public" className="cursor-pointer font-normal">
                  Public
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="private" id="visibility-private" />
                <Label htmlFor="visibility-private" className="cursor-pointer font-normal">
                  Private
                </Label>
              </div>
            </RadioGroup>
          </div>

          {error && !validationError && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error.split('\n').map((line, i) => (
                <p key={i}>{line}</p>
              ))}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={isCreating}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                !!validationError || !repoName.trim() || !owner || isCreating || isValidating
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
    </DialogContent>
  );
};
