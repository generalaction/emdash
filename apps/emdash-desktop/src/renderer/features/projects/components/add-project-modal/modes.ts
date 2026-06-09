import { useState } from 'react';
import { useGitHubRepositoryOwnerSelect } from '@renderer/lib/hooks/useGithubRepositoryOwners';
import { basenameFromAnyPath } from '@shared/path-name';

export function usePickMode() {
  const [path, setPath] = useState('');
  const [name, setName] = useState('');
  const [nameIsTouched, setNameIsTouched] = useState<boolean>(false);
  const [initGitRepository, setinitGitRepository] = useState<boolean>(false);

  const handlePathChange = (newPath: string) => {
    setPath(newPath);
    setinitGitRepository(false);
    if (!nameIsTouched) {
      const dirName = basenameFromAnyPath(newPath);
      if (dirName && !nameIsTouched) setName(dirName);
    }
  };

  const handleNameChange = (newName: string) => {
    setName(newName);
    setNameIsTouched(true);
  };

  const isValid = name.trim().length > 0 && path.trim().length > 0;

  return {
    path,
    name,
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

export function useNewMode(defaultPath: string, githubAccountId: string | null) {
  const [name, setName] = useState('');
  const [_, setNameIsTouched] = useState<boolean>(false);
  const [repositoryName, setRepositoryName] = useState('');
  const [repositoryNameIsTouched, setRepositoryNameIsTouched] = useState<boolean>(false);
  const [repositoryVisibility, setRepositoryVisibility] = useState<'public' | 'private'>('private');
  const [pathOverride, setPathOverride] = useState<string | undefined>(undefined);
  const path = pathOverride ?? defaultPath;
  const {
    owners,
    owner: repositoryOwner,
    errorMessage: repositoryOwnersErrorMessage,
    handleOwnerChange,
  } = useGitHubRepositoryOwnerSelect(githubAccountId);

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

  const isValid =
    name.trim().length > 0 &&
    repositoryName.trim().length > 0 &&
    !!repositoryOwner &&
    path.trim().length > 0;

  return {
    name,
    repositoryName,
    repositoryOwner,
    repositoryVisibility,
    owners,
    repositoryOwnersErrorMessage,
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

  const handleRepositoryUrlChange = (newRepositoryUrl: string) => {
    setRepositoryUrl(newRepositoryUrl);
    if (!nameIsTouched) setName(extractRepoName(newRepositoryUrl));
  };

  const handleNameChange = (newName: string) => {
    setName(newName);
    setNameIsTouched(true);
  };

  const isValid =
    name.trim().length > 0 && repositoryUrl.trim().length > 0 && path.trim().length > 0;

  return {
    repositoryUrl,
    name,
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
