import type { InterfaceSettings } from '@shared/app-settings';

type ConversationUiMode = InterfaceSettings['conversationUiMode'];

export function resolveConversationUiModeSelection(
  currentMode: ConversationUiMode,
  selectedModes: string[]
): ConversationUiMode | null {
  const next = selectedModes.find((mode) => mode !== currentMode);
  return next === 'terminal' || next === 'chat' ? next : null;
}
