import { createContext, useContext } from 'react';

export type TaskConfigOptions = {
  /** Whether PR-related presets are visible. Set to false in automation contexts. Defaults to true. */
  showPrPresets?: boolean;
  /** When true, BranchNameField shows a read-only "auto-generated" placeholder instead of an input. Defaults to false. */
  autoBranchName?: boolean;
};

type ResolvedTaskConfig = Required<TaskConfigOptions>;

const defaults: ResolvedTaskConfig = {
  showPrPresets: true,
  autoBranchName: false,
};

const TaskConfigContext = createContext<ResolvedTaskConfig>(defaults);

export function TaskConfigProvider({
  children,
  showPrPresets,
  autoBranchName,
}: TaskConfigOptions & { children: React.ReactNode }) {
  const value: ResolvedTaskConfig = {
    showPrPresets: showPrPresets ?? defaults.showPrPresets,
    autoBranchName: autoBranchName ?? defaults.autoBranchName,
  };

  return <TaskConfigContext.Provider value={value}>{children}</TaskConfigContext.Provider>;
}

export function useTaskConfig(): ResolvedTaskConfig {
  return useContext(TaskConfigContext);
}
