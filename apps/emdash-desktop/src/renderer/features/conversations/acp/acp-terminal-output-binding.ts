type TerminalOutputBinding = {
  text(): string;
  subscribe(listener: () => void): () => void;
};

type TerminalOutputSession = {
  terminals: {
    getSnapshot(): ReadonlyArray<{ terminalId: string }> | undefined;
    subscribe(listener: () => void): () => void;
  };
  terminalOutput(terminalId: string): Promise<TerminalOutputBinding>;
};

export function bindSessionTerminalOutputs(
  session: TerminalOutputSession,
  setTerminalOutput: (terminalId: string, text: string | null) => void
): () => void {
  const terminalUnsubs = new Map<string, () => void>();
  let disposed = false;

  const removeTerminal = (terminalId: string): void => {
    terminalUnsubs.get(terminalId)?.();
    terminalUnsubs.delete(terminalId);
  };

  const syncTerminals = (): void => {
    if (disposed) return;
    const nextIds = new Set(
      (session.terminals.getSnapshot() ?? []).map((terminal) => terminal.terminalId)
    );

    for (const terminalId of Array.from(terminalUnsubs.keys())) {
      if (!nextIds.has(terminalId)) removeTerminal(terminalId);
    }

    for (const terminalId of nextIds) {
      if (terminalUnsubs.has(terminalId)) continue;

      let unsubscribeLog: (() => void) | undefined;
      let active = true;
      terminalUnsubs.set(terminalId, () => {
        active = false;
        unsubscribeLog?.();
        setTerminalOutput(terminalId, null);
      });

      void session
        .terminalOutput(terminalId)
        .then((binding) => {
          if (disposed || !active) return;
          const syncOutput = (): void => setTerminalOutput(terminalId, binding.text());
          syncOutput();
          unsubscribeLog = binding.subscribe(syncOutput);
        })
        .catch(() => {
          if (active) setTerminalOutput(terminalId, null);
        });
    }
  };

  syncTerminals();
  const unsubscribeTerminals = session.terminals.subscribe(syncTerminals);
  return () => {
    disposed = true;
    unsubscribeTerminals();
    for (const terminalId of Array.from(terminalUnsubs.keys())) {
      removeTerminal(terminalId);
    }
  };
}
