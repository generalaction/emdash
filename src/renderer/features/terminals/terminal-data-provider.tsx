import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useMemo } from 'react';
import type { CreateTerminalParams, Terminal } from '@shared/terminals';
import { rpc } from '@renderer/core/ipc';

interface TerminalDataContextValue {
  terminals: Terminal[];
  terminalsByTaskId: Record<string, Terminal[]>;
  createTerminal: (params: CreateTerminalParams) => Promise<Terminal>;
  deleteTerminal: (params: { projectId: string; taskId: string; terminalId: string }) => void;
}

const TerminalDataContext = createContext<TerminalDataContextValue | null>(null);

export function TerminalDataProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();

  const { data: terminals } = useQuery({
    queryKey: ['terminals'],
    queryFn: () => rpc.terminals.getAllTerminals(),
  });

  const terminalsByTaskId = useMemo(() => {
    return (terminals ?? []).reduce(
      (acc, terminal) => {
        acc[terminal.taskId] = [...(acc[terminal.taskId] ?? []), terminal];
        return acc;
      },
      {} as Record<string, Terminal[]>
    );
  }, [terminals]);

  const createTerminalMutation = useMutation({
    mutationFn: rpc.terminals.createTerminal,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['terminals'] });
    },
  });

  const deleteTerminalMutation = useMutation({
    mutationFn: (params: { projectId: string; taskId: string; terminalId: string }) =>
      rpc.terminals.deleteTerminal(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['terminals'] });
    },
  });

  const createTerminal = useCallback(
    (params: CreateTerminalParams): Promise<Terminal> => {
      return createTerminalMutation.mutateAsync(params);
    },
    [createTerminalMutation]
  );

  const deleteTerminal = useCallback(
    (params: { projectId: string; taskId: string; terminalId: string }) => {
      deleteTerminalMutation.mutate(params);
    },
    [deleteTerminalMutation]
  );

  return (
    <TerminalDataContext.Provider
      value={{
        terminals: terminals ?? [],
        terminalsByTaskId,
        createTerminal,
        deleteTerminal,
      }}
    >
      {children}
    </TerminalDataContext.Provider>
  );
}

export function useTerminalsContext() {
  const context = useContext(TerminalDataContext);
  if (!context) {
    throw new Error('useTerminalsContext must be used within a TerminalDataProvider');
  }
  return context;
}
