export type TerminalPanelActiveItem =
  | { kind: 'terminal'; id: string }
  | { kind: 'script'; id: string };

export function resolveTerminalPanelActiveItem({
  requestedActiveItem,
  activeTerminalId,
  terminalIds,
  scriptIds,
}: {
  requestedActiveItem: TerminalPanelActiveItem | undefined;
  activeTerminalId: string | undefined;
  terminalIds: readonly string[];
  scriptIds: readonly string[];
}): TerminalPanelActiveItem {
  if (requestedActiveItem?.kind === 'terminal' && terminalIds.includes(requestedActiveItem.id)) {
    return requestedActiveItem;
  }

  if (requestedActiveItem?.kind === 'script' && scriptIds.includes(requestedActiveItem.id)) {
    return requestedActiveItem;
  }

  if (activeTerminalId && terminalIds.includes(activeTerminalId)) {
    return { kind: 'terminal', id: activeTerminalId };
  }

  const firstScriptId = scriptIds[0];
  if (firstScriptId) {
    return { kind: 'script', id: firstScriptId };
  }

  return { kind: 'terminal', id: terminalIds[0] ?? '' };
}
