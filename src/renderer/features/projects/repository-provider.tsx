import { useQuery } from '@tanstack/react-query';
import { createContext, useContext } from 'react';
import { Branch, DefaultBranch } from '@shared/git';
import { rpc } from '@renderer/lib/ipc';

interface RepositoryContextValue {
  branches: Branch[];
  defaultBranch?: DefaultBranch;
}

const RepositoryContext = createContext<RepositoryContextValue | undefined>(undefined);

export function RepositoryProvider({
  children,
  projectId,
}: {
  children: React.ReactNode;
  projectId: string;
}) {
  const { data: branches } = useQuery({
    queryKey: ['repository', 'branches', projectId],
    queryFn: () => rpc.repository.getBranches(projectId),
  });
  const { data: defaultBranch } = useQuery({
    queryKey: ['repository', 'defaultBranch', projectId],
    queryFn: () => rpc.repository.getDefaultBranch(projectId),
  });
  return (
    <RepositoryContext.Provider value={{ branches: branches ?? [], defaultBranch }}>
      {children}
    </RepositoryContext.Provider>
  );
}

export function useRepositoryContext() {
  const context = useContext(RepositoryContext);
  if (!context) {
    throw new Error('useRepositoryContext must be used within a RepositoryProvider');
  }
  return context;
}
