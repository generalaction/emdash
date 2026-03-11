import { Tabs } from '@base-ui/react';
import { useQuery } from '@tanstack/react-query';
import { ChevronsUpDownIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { rpc } from '@renderer/lib/ipc';
import { ComboboxTrigger, ComboboxValue } from '../ui/combobox';
import { ComboboxPopover, ComboboxSelectOption } from '../ui/combobox-popover';
import { Field, FieldLabel } from '../ui/field';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import { Strategy } from './add-project-modal';
import { LocalDirectorySelector } from './local-directory-selector';
import { RemoteDirectorySelector } from './remote-directory-selector';

interface PickExistingPanelProps {
  strategy: Strategy;
  connectionId?: string;
}

export function PickExistingPanel({ strategy, connectionId }: PickExistingPanelProps) {
  const [path, setPath] = useState('');
  const [name, setName] = useState('');
  const [nameIsTouched, setNameIsTouched] = useState<boolean>(false);

  const handlePathChange = (newPath: string) => {
    setPath(newPath);
    if (!nameIsTouched) {
      const dirName = newPath.split('/').filter(Boolean).pop() ?? '';
      if (dirName && !nameIsTouched) setName(dirName);
    }
  };

  const handleNameChange = (newName: string) => {
    setName(newName);
    setNameIsTouched(true);
  };

  return (
    <Tabs.Panel value="pick">
      <Field>
        <FieldLabel>{strategy === 'local' ? 'Project Directory' : 'Remote Directory'}</FieldLabel>
        {strategy === 'local' ? (
          <LocalDirectorySelector
            path={path}
            onPathChange={handlePathChange}
            title="Select a local project"
            message="Select a project directory to open"
          />
        ) : (
          <RemoteDirectorySelector
            connectionId={connectionId}
            value={path}
            onChange={handlePathChange}
          />
        )}
      </Field>
      <Field>
        <FieldLabel>Project Name</FieldLabel>
        <Input
          placeholder="Enter a project name"
          value={name}
          onChange={(e) => handleNameChange(e.target.value)}
        />
      </Field>
    </Tabs.Panel>
  );
}

export function CreateNewPanel({
  strategy,
  connectionId,
}: {
  strategy: Strategy;
  connectionId?: string;
}) {
  const [name, setName] = useState('');
  const [repositoryName, setRepositoryName] = useState('');
  const [repositoryNameIsTouched, setRepositoryNameIsTouched] = useState<boolean>(false);
  const [repositoryOwner, setRepositoryOwner] = useState<ComboboxSelectOption | undefined>(
    undefined
  );
  const [repositoryVisibility, setRepositoryVisibility] = useState<'public' | 'private'>('private');
  const [path, setPath] = useState('');

  const [ownerIsTouched, setOwnerIsTouched] = useState<boolean>(false);

  const handleNameChange = (newName: string) => {
    setName(newName);
    if (!repositoryNameIsTouched) setRepositoryName(newName);
  };

  const handleRepositoryNameChange = (newRepositoryName: string) => {
    setRepositoryName(newRepositoryName);
    setRepositoryNameIsTouched(true);
  };

  const { data } = useQuery({
    queryKey: ['owners'],
    queryFn: () => rpc.github.getOwners(),
  });

  const owners = useMemo(
    () => data?.owners?.map((owner) => ({ value: owner.login, label: owner.login })) ?? [],
    [data]
  );

  useEffect(() => {
    if (!ownerIsTouched && owners.length > 0) {
      setRepositoryOwner(owners[0]);
    }
  }, [owners, ownerIsTouched]);

  const handleOwnerChange = (item: ComboboxSelectOption) => {
    setRepositoryOwner(item);
    setOwnerIsTouched(true);
  };

  return (
    <Tabs.Panel value="new">
      <Field>
        <FieldLabel>Project Name</FieldLabel>
        <Input
          placeholder="Enter a project name"
          value={name}
          onChange={(e) => handleNameChange(e.target.value)}
        />
      </Field>
      <Field>
        <FieldLabel>Repository Name</FieldLabel>
        <Input
          placeholder="Enter a repository name"
          value={repositoryName}
          onChange={(e) => handleRepositoryNameChange(e.target.value)}
        />
      </Field>
      <Field>
        <FieldLabel>Repository Owner</FieldLabel>
        <ComboboxPopover
          trigger={
            <ComboboxTrigger
              render={
                <button className="flex h-9 w-full min-w-0 items-center justify-between rounded-md border border-border px-2.5 py-1 text-left text-sm outline-none">
                  <ComboboxValue />
                  <ChevronsUpDownIcon className="size-4 shrink-0 text-muted-foreground" />
                </button>
              }
            />
          }
          items={owners}
          defaultValue={owners[0]}
          value={repositoryOwner ?? null}
          onValueChange={handleOwnerChange}
        />
      </Field>
      <Field>
        <FieldLabel>Repository Privacy</FieldLabel>
        <RadioGroup
          value={repositoryVisibility}
          onValueChange={(value) => setRepositoryVisibility(value as 'public' | 'private')}
        >
          <div className="flex items-center gap-3">
            <RadioGroupItem value="private" />
            <Label className="cursor-pointer font-normal">Private</Label>
          </div>
          <div className="flex items-center gap-3">
            <RadioGroupItem value="public" />
            <Label className="cursor-pointer font-normal">Public</Label>
          </div>
        </RadioGroup>
      </Field>
      <Field>
        <FieldLabel>{strategy === 'local' ? 'Project Directory' : 'Remote Directory'}</FieldLabel>
        {strategy === 'local' ? (
          <LocalDirectorySelector
            path={path}
            onPathChange={setPath}
            title="Select a local project"
            message="Select a project directory to open"
          />
        ) : (
          <RemoteDirectorySelector connectionId={connectionId} value={path} onChange={setPath} />
        )}
      </Field>
    </Tabs.Panel>
  );
}

export function ClonePanel({
  strategy,
  connectionId,
}: {
  strategy: Strategy;
  connectionId?: string;
}) {
  const [repositoryUrl, setRepositoryUrl] = useState('');
  const [name, setName] = useState('');
  const [nameIsTouched, setNameIsTouched] = useState<boolean>(false);
  const [path, setPath] = useState('');

  const handleRepositoryUrlChange = (newRepositoryUrl: string) => {
    setRepositoryUrl(newRepositoryUrl);
    if (!nameIsTouched) setName(extractRepoName(newRepositoryUrl));
  };

  const handleNameChange = (newName: string) => {
    setName(newName);
    setNameIsTouched(true);
  };

  return (
    <Tabs.Panel value="clone">
      <Field>
        <FieldLabel>Repository URL</FieldLabel>
        <Input
          placeholder="Enter a repository URL"
          value={repositoryUrl}
          onChange={(e) => handleRepositoryUrlChange(e.target.value)}
        />
      </Field>
      <Field>
        <FieldLabel>Project Name</FieldLabel>
        <Input
          placeholder="Enter a project name"
          value={name}
          onChange={(e) => handleNameChange(e.target.value)}
        />
      </Field>
      <Field>
        <FieldLabel>{strategy === 'local' ? 'Project Directory' : 'Remote Directory'}</FieldLabel>
        {strategy === 'local' ? (
          <LocalDirectorySelector
            path={path}
            onPathChange={setPath}
            title="Select a local project"
            message="Select a project directory to open"
          />
        ) : (
          <RemoteDirectorySelector connectionId={connectionId} value={path} onChange={setPath} />
        )}
      </Field>
    </Tabs.Panel>
  );
}

function extractRepoName(url: string): string {
  try {
    const parts = url.replace(/\.git$/, '').split('/');
    return parts[parts.length - 1] ?? '';
  } catch {
    return '';
  }
}
