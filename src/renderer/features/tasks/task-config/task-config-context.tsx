import { createContext, useContext } from 'react';

export type TaskConfigOptions = {
  /** Label shown on the conversation/prompt tab. Defaults to 'Initial Conversation'. */
  conversationLabel?: string;
  /** Whether PR-related presets are visible. Set to false in automation contexts. Defaults to true. */
  showPrPresets?: boolean;
};

type ResolvedTaskConfig = Required<TaskConfigOptions>;

const defaults: ResolvedTaskConfig = {
  conversationLabel: 'Initial Conversation',
  showPrPresets: true,
};

const TaskConfigContext = createContext<ResolvedTaskConfig>(defaults);

export function TaskConfigProvider({
  children,
  conversationLabel,
  showPrPresets,
}: TaskConfigOptions & { children: React.ReactNode }) {
  const value: ResolvedTaskConfig = {
    conversationLabel: conversationLabel ?? defaults.conversationLabel,
    showPrPresets: showPrPresets ?? defaults.showPrPresets,
  };

  return <TaskConfigContext.Provider value={value}>{children}</TaskConfigContext.Provider>;
}

export function useTaskConfig(): ResolvedTaskConfig {
  return useContext(TaskConfigContext);
}
