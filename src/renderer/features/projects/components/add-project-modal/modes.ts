import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { rpc } from '@renderer/lib/ipc';
import { useGithubContext } from '@renderer/lib/providers/github-context-provider';
import type { ComboboxSelectOption } from '@renderer/lib/ui/combobox-popover';
import { basenameFromAnyPath } from '@shared/path-name';

export function usePickMode() {
  const [path, setPath] = useState('');
  const [name, setName] = useState('');
  const [nameIsTouched, setNameIsTouched] = useState<boolean>(false);
  const [initGitRepository, setinitGitRepository] = useState<boolean>(false);

  const namePlaceholder = basenameFromAnyPath(path) || 'Project name...';

  const handlePathChange = (newPath: string) => {
    setPath(newPath);
    setinitGitRepository(false);
  };

  const handleNameChange = (newName: string) => {
    setName(newName);
    setNameIsTouched(true);
  };

  const effectiveName = nameIsTouched ? name : '';
  const isValid = (name.trim().length > 0 || !!basenameFromAnyPath(path)) && path.trim().length > 0;

  return {
    path,
    name,
    namePlaceholder,
    effectiveName,
    initGitRepository,
    setinitGitRepository,
    handlePathChange,
    handleNameChange,
    isValid,
  };
}

export type PickModeState = ReturnType<typeof usePickMode>;
export type NewModeState = ReturnType<typeof useNewMode>;
export type CloneModeState = ReturnType<typeof useCloneMode>;

export function useNewMode(defaultPath: string) {
  const { authenticated } = useGithubContext();
  const [name, setName] = useState('');
  const [_nameIsTouched, setNameIsTouched] = useState<boolean>(false);
  const [repositoryName, setRepositoryName] = useState('');
  const [repositoryNameIsTouched, setRepositoryNameIsTouched] = useState<boolean>(false);
  const [repositoryOwnerOverride, setRepositoryOwnerOverride] = useState<
    ComboboxSelectOption | undefined
  >(undefined);
  const [repositoryVisibility, setRepositoryVisibility] = useState<'public' | 'private'>('private');
  const [pathOverride, setPathOverride] = useState<string | undefined>(undefined);
  const path = pathOverride ?? defaultPath;

  const [ownerIsTouched, setOwnerIsTouched] = useState<boolean>(false);

  const namePlaceholder = repositoryName || 'Project name...';

  const handleNameChange = (newName: string) => {
    setName(newName);
    setNameIsTouched(true);
    if (!repositoryNameIsTouched) setRepositoryName(newName);
  };

  const handleRepositoryNameChange = (newRepositoryName: string) => {
    setRepositoryName(newRepositoryName);
    setRepositoryNameIsTouched(true);
    setName(newRepositoryName);
    setNameIsTouched(false);
  };

  const { data } = useQuery({
    queryKey: ['owners'],
    queryFn: () => rpc.github.getOwners(),
    enabled: authenticated,
  });

  const owners = useMemo(
    () =>
      authenticated
        ? (data?.owners?.map((owner) => ({ value: owner.login, label: owner.login })) ?? [])
        : [],
    [authenticated, data]
  );

  const repositoryOwner = useMemo(
    () => (ownerIsTouched ? repositoryOwnerOverride : owners[0]),
    [owners, ownerIsTouched, repositoryOwnerOverride]
  );

  const handleOwnerChange = (item: ComboboxSelectOption) => {
    setRepositoryOwnerOverride(item);
    setOwnerIsTouched(true);
  };

  const effectiveName = name || repositoryName;

  const isValid =
    effectiveName.trim().length > 0 &&
    repositoryName.trim().length > 0 &&
    !!repositoryOwner &&
    path.trim().length > 0;

  return {
    name,
    namePlaceholder,
    effectiveName,
    repositoryName,
    repositoryOwner,
    repositoryVisibility,
    owners,
    setRepositoryVisibility,
    path,
    setPath: setPathOverride,
    handleNameChange,
    handleRepositoryNameChange,
    handleOwnerChange,
    isValid,
  };
}

export function useCloneMode(defaultPath: string) {
  const [repositoryUrl, setRepositoryUrl] = useState('');
  const [name, setName] = useState('');
  const [nameIsTouched, setNameIsTouched] = useState<boolean>(false);
  const [pathOverride, setPathOverride] = useState<string | undefined>(undefined);
  const path = pathOverride ?? defaultPath;

  const namePlaceholder = extractRepoName(repositoryUrl) || 'Project name...';

  const handleRepositoryUrlChange = (newRepositoryUrl: string) => {
    setRepositoryUrl(newRepositoryUrl);
  };

  const handleNameChange = (newName: string) => {
    setName(newName);
    setNameIsTouched(true);
  };

  const effectiveName = nameIsTouched ? name : extractRepoName(repositoryUrl);

  const isValid =
    (name.trim().length > 0 || !!extractRepoName(repositoryUrl)) &&
    repositoryUrl.trim().length > 0 &&
    path.trim().length > 0;

  return {
    repositoryUrl,
    name,
    namePlaceholder,
    effectiveName,
    path,
    setPath: setPathOverride,
    handleRepositoryUrlChange,
    handleNameChange,
    isValid,
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
