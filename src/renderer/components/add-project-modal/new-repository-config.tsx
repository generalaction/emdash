import { Field, FieldLabel } from '../ui/field';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import { LocalDirectorySelector } from './local-directory-selector';

interface NewRepositoryConfigProps {
  path: string;
  onPathChange: (path: string) => void;
  name: string;
  onNameChange: (name: string) => void;
  repositoryName: string;
  onRepositoryNameChange: (repositoryName: string) => void;
  repositoryVisibility: 'public' | 'private';
  onRepositoryVisibilityChange: (repositoryVisibility: 'public' | 'private') => void;
}

export function NewRepositoryConfig({
  path,
  onPathChange,
  name,
  onNameChange,
  repositoryName,
  onRepositoryNameChange,
  repositoryVisibility,
  onRepositoryVisibilityChange,
}: NewRepositoryConfigProps) {
  return (
    <>
      <Field>
        <FieldLabel>Project Directory</FieldLabel>
        <LocalDirectorySelector
          onPathChange={onPathChange}
          path={path}
          title="Select a local project"
          message="Select a project directory to open"
        />
      </Field>
      <Field>
        <FieldLabel>Project Name</FieldLabel>
        <Input
          placeholder="Enter a project name"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
        />
      </Field>
      <Field>
        <FieldLabel>Repository Name</FieldLabel>
        <Input
          placeholder="Enter a repository name"
          value={repositoryName}
          onChange={(e) => onRepositoryNameChange(e.target.value)}
        />
      </Field>
      <Field>
        <FieldLabel>Repository Privacy</FieldLabel>
        <RadioGroup
          value={repositoryVisibility}
          onValueChange={(value) => onRepositoryVisibilityChange(value as 'public' | 'private')}
        >
          <div className="flex items-center gap-3">
            <RadioGroupItem value="public" />
            <Label htmlFor="visibility-public" className="cursor-pointer font-normal">
              Public
            </Label>
          </div>
          <div className="flex items-center gap-3">
            <RadioGroupItem value="private" />
            <Label htmlFor="visibility-private" className="cursor-pointer font-normal">
              Private
            </Label>
          </div>
        </RadioGroup>
      </Field>
    </>
  );
}
