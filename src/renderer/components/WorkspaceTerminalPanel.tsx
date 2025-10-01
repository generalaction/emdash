import React from "react";
import { TerminalPane } from "./TerminalPane";
import { Bot, Terminal } from "lucide-react";

interface Workspace {
  id: string;
  name: string;
  branch: string;
  path: string;
  status: "active" | "idle" | "running";
}

interface Props {
  workspace: Workspace | null;
  className?: string;
}

export const WorkspaceTerminalPanel: React.FC<Props> = ({
  workspace,
  className,
}) => {
  if (!workspace) {
    return (
      <div
        className={`flex flex-col items-center justify-center h-full bg-gray-50 dark:bg-gray-900 ${className}`}
      >
        <Bot className="w-8 h-8 text-gray-400 mb-2" />
        <h3 className="text-sm text-gray-600 dark:text-gray-400 mb-1">
          No Workspace Selected
        </h3>
        <p className="text-xs text-gray-500 dark:text-gray-500 text-center">
          Select a workspace to view its terminal
        </p>
      </div>
    );
  }

  return (
    <div
      className={`flex flex-col h-full bg-white dark:bg-gray-800 rounded-2xl overflow-hidden shadow-lg ${className}`}
    >
      <div className="flex items-center px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
        <div className="flex items-center space-x-2 min-w-0">
          <h3
            className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate max-w-[220px]"
            title={workspace.name}
          >
            Terminal
          </h3>
        </div>
      </div>

      <div className="flex-1 bg-black overflow-hidden p-2.5">
        <TerminalPane
          id={`workspace-${workspace.id}`}
          cwd={workspace.path}
          className="h-full w-full"
        />
      </div>
    </div>
  );
};

export default WorkspaceTerminalPanel;
