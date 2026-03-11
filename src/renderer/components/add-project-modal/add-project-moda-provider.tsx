import { createContext, ReactNode } from 'react';
import { Mode } from './add-project-modal';

type AddProjectModalContextValue = {
  path: string;
  setPath: (path: string) => void;
  name: string;
  setName: (name: string) => void;
  repositoryName: string;
  setRepositoryName: (repositoryName: string) => void;
  repositoryVisibility: 'public' | 'private';
  setRepositoryVisibility: (repositoryVisibility: 'public' | 'private') => void;
  repositoryUrl: string;
  setRepositoryUrl: (repositoryUrl: string) => void;
  mode: Mode;
  setMode: (mode: Mode) => void;
  connectionId: string | undefined;
  setConnectionId: (connectionId: string | undefined) => void;
};

const AddProjectModalContext = createContext<AddProjectModalContextValue | null>(null);

export function AddProjectModalProvider({ children }: { children: ReactNode }) {
  return <AddProjectModalContext.Provider value={{}}>{children}</AddProjectModalContext.Provider>;
}
