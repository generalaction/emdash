import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/button';
import { ConfirmButton } from '../../components/ui/confirm-button';
import { DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { RadioGroup, RadioGroupItem } from '../../components/ui/radio-group';
import { Separator } from '../../components/ui/separator';
import { SlugInput } from '../../components/ui/slug-input';
import { Spinner } from '../../components/ui/spinner';
import { rpc } from '../ipc';
import { useCloseGuard } from '../modal/use-close-guard';

interface NewProjectModalProps {
  onClose: () => void;
  onSuccess: (projectPath: string) => void;
}

interface Owner {
  login: string;
  type: 'User' | 'Organization';
}

export const NewProjectModal: React.FC<NewProjectModalProps> = ({ onClose, onSuccess }) => {
  const [repoName, setRepoName] = useState('');
  const [description, setDescription] = useState('');
  const [owner, setOwner] = useState<string>('');
  const [_owners, setOwners] = useState<Owner[]>([]);
  const [isPrivate, setIsPrivate] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  useCloseGuard(isCreating);
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
        const result = await rpc.github.getOwners();
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
        const result = await rpc.github.validateRepoName(repoName.trim(), owner);
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
        const result = await rpc.github.createNewProject({
          name: repoName.trim(),
          description: description.trim() || undefined,
          owner,
          isPrivate,
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
    [repoName, description, owner, isPrivate, validationError, onSuccess, onClose]
  );

  return (
    <>
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
            <ConfirmButton
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
            </ConfirmButton>
          </div>
        </form>
      )}
    </>
  );
};
