import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { rpc } from '@renderer/lib/ipc';
import { ComboboxSelectOption } from '../ui/combobox-popover';

export function usePickMode() {
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

  return {
    path,
    name,
    handlePathChange,
    handleNameChange,
  };
}

export type PickModeState = ReturnType<typeof usePickMode>;
export type NewModeState = ReturnType<typeof useNewMode>;
export type CloneModeState = ReturnType<typeof useCloneMode>;

export function useNewMode() {
  const [name, setName] = useState('');
  const [repositoryName, setRepositoryName] = useState('');
  const [repositoryNameIsTouched, setRepositoryNameIsTouched] = useState<boolean>(false);
  const [repositoryOwnerOverride, setRepositoryOwnerOverride] = useState<
    ComboboxSelectOption | undefined
  >(undefined);
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

  const repositoryOwner = useMemo(
    () => (ownerIsTouched ? repositoryOwnerOverride : owners[0]),
    [owners, ownerIsTouched, repositoryOwnerOverride]
  );

  const handleOwnerChange = (item: ComboboxSelectOption) => {
    setRepositoryOwnerOverride(item);
    setOwnerIsTouched(true);
  };

  return {
    name,
    repositoryName,
    repositoryOwner,
    repositoryVisibility,
    owners,
    setRepositoryVisibility,
    path,
    setPath,
    handleNameChange,
    handleRepositoryNameChange,
    handleOwnerChange,
  };
}

export function useCloneMode() {
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

  return {
    repositoryUrl,
    name,
    path,
    setPath,
    handleRepositoryUrlChange,
    handleNameChange,
  };
}

function extractRepoName(url: string): string {
  try {
    const parts = url.replace(/\.git$/, '').split('/');
    return parts[parts.length - 1] ?? '';
  } catch {
    return '';
  }
}
