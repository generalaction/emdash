import React from "react";
import ReorderList from "./ReorderList";
import { Button } from "./ui/button";
import {
  SidebarProvider,
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarFooter,
} from "./ui/sidebar";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "./ui/collapsible";
import { Home, ChevronDown } from "lucide-react";
import GithubStatus from "./GithubStatus";
import { WorkspaceItem } from "./WorkspaceItem";
import { ThemeToggle } from "./ThemeToggle";
import { formatCompactTime } from "../lib/timeUtils";

interface Project {
  id: string;
  name: string;
  path: string;
  gitInfo: {
    isGitRepo: boolean;
    remote?: string;
    branch?: string;
  };
  githubInfo?: {
    repository: string;
    connected: boolean;
  };
  workspaces?: Workspace[];
  createdAt?: string;
  updatedAt?: string;
}

interface Workspace {
  id: string;
  name: string;
  branch: string;
  path: string;
  status: "active" | "idle" | "running";
  agentId?: string;
}

interface LeftSidebarProps {
  projects: Project[];
  selectedProject: Project | null;
  onSelectProject: (project: Project) => void;
  onGoHome: () => void;
  onSelectWorkspace?: (workspace: Workspace) => void;
  activeWorkspace?: Workspace | null;
  onReorderProjects?: (sourceId: string, targetId: string) => void;
  onReorderProjectsFull?: (newOrder: Project[]) => void;
  githubInstalled?: boolean;
  githubAuthenticated?: boolean;
  githubUser?: { login?: string; name?: string } | null;
}

const LeftSidebar: React.FC<LeftSidebarProps> = ({
  projects,
  selectedProject,
  onSelectProject,
  onGoHome,
  onSelectWorkspace,
  activeWorkspace,
  onReorderProjects,
  onReorderProjectsFull,
  githubInstalled = true,
  githubAuthenticated = false,
  githubUser,
}) => {
  const renderGithubStatus = () => (
    <GithubStatus installed={githubInstalled} authenticated={githubAuthenticated} user={githubUser} />
  );

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarContent className="px-4 py-6">
          <SidebarGroup>
            <SidebarGroupContent>
              <div className="flex items-center justify-between px-1 py-2 mb-4">
                <Button
                  variant="ghost"
                  onClick={onGoHome}
                  aria-label="Home"
                  className="flex items-center gap-3 h-9 px-3 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                >
                  <Home className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Home</span>
                </Button>
                <ThemeToggle />
              </div>
            </SidebarGroupContent>
          </SidebarGroup>

          <SidebarGroup className="mt-6">
            <SidebarGroupLabel className="px-2 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Projects</SidebarGroupLabel>
            <SidebarGroupContent className="mt-3">
              <SidebarMenu>
                <ReorderList
                  as="div"
                  axis="y"
                  items={projects}
                  onReorder={(newOrder) => {
                    if (onReorderProjectsFull) {
                      onReorderProjectsFull(newOrder as Project[]);
                    } else if (onReorderProjects) {
                      const oldIds = projects.map((p) => p.id);
                      const newIds = (newOrder as Project[]).map((p) => p.id);
                      for (let i = 0; i < newIds.length; i++) {
                        if (newIds[i] !== oldIds[i]) {
                          const sourceId = newIds.find((id) => id === oldIds[i]);
                          const targetId = newIds[i];
                          if (sourceId && targetId && sourceId !== targetId) {
                            onReorderProjects(sourceId, targetId);
                          }
                          break;
                        }
                      }
                    }
                  }}
                  className="space-y-2 list-none p-0 m-0 min-w-0"
                  itemClassName="relative group cursor-pointer rounded-lg list-none min-w-0"
                  getKey={(p) => (p as Project).id}
                >
                  {(project) => {
                    const typedProject = project as Project;
                    return (
                      <SidebarMenuItem>
                        <Collapsible defaultOpen className="group/collapsible">
                          <div className="flex w-full items-center rounded-lg px-3 py-3 text-sm font-medium hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors min-w-0 border border-transparent hover:border-gray-200 dark:hover:border-gray-700">
                            <button
                              type="button"
                              className="flex flex-1 min-w-0 flex-col text-left bg-transparent outline-none focus-visible:outline-none"
                              onClick={(e) => {
                                e.stopPropagation();
                                onSelectProject(typedProject);
                              }}
                            >
                              <div className="flex items-center justify-between w-full">
                                <span className="truncate block">{typedProject.name}</span>
                                {typedProject.updatedAt && (
                                  <span className="text-xs text-gray-400 dark:text-gray-500 ml-2 shrink-0">
                                    {formatCompactTime(typedProject.updatedAt)}
                                  </span>
                                )}
                              </div>
                              <span className="hidden sm:block truncate text-xs text-muted-foreground">
                                {typedProject.githubInfo?.repository || typedProject.path}
                              </span>
                            </button>
                            <CollapsibleTrigger asChild>
                              <button
                                type="button"
                                aria-label={`Toggle workspaces for ${typedProject.name}`}
                                onClick={(e) => e.stopPropagation()}
                                className="ml-2 -mr-1 rounded-lg p-1.5 text-gray-400 dark:text-gray-500 transition-colors hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-gray-600 dark:hover:text-gray-300 focus-visible:outline-none"
                              >
                                <ChevronDown className="h-4 w-4 transition-transform group-data-[state=open]/collapsible:rotate-180" />
                              </button>
                            </CollapsibleTrigger>
                          </div>

                          <CollapsibleContent asChild>
                            <div>
                              {typedProject.workspaces?.length ? (
                                <div className="hidden sm:block mt-3 ml-6 space-y-2 min-w-0">
                                  {typedProject.workspaces.map((workspace) => {
                                    const isActive = activeWorkspace?.id === workspace.id;
                                    return (
                                      <div
                                        key={workspace.id}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          if (
                                            onSelectProject &&
                                            selectedProject?.id !== typedProject.id
                                          ) {
                                            onSelectProject(typedProject);
                                          }
                                          onSelectWorkspace &&
                                            onSelectWorkspace(workspace);
                                        }}
                                        className={`px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-900/40 border-b border-gray-100 dark:border-gray-700 last:border-b-0 cursor-pointer transition-colors min-w-0 ${
                                          isActive ? "bg-gray-100 dark:bg-gray-700" : ""
                                        }`}
                                        title={workspace.name}
                                      >
                                        <WorkspaceItem workspace={workspace} />
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : null}
                            </div>
                          </CollapsibleContent>
                        </Collapsible>
                      </SidebarMenuItem>
                    );
                  }}
                </ReorderList>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className="border-t border-gray-200 dark:border-gray-700 px-4 py-4 mt-auto">
          <SidebarMenu className="w-full">
            <SidebarMenuItem>
              <SidebarMenuButton
                tabIndex={-1}
                onClick={(e) => e.preventDefault()}
                className="flex w-full items-center justify-start gap-2 px-2 py-2 text-sm text-muted-foreground cursor-default hover:bg-transparent focus-visible:outline-none focus-visible:ring-0"
              >
                <div className="flex flex-1 flex-col min-w-0 text-left gap-1">
                  <div className="hidden sm:block truncate">
                    {renderGithubStatus()}
                  </div>
                </div>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
    </SidebarProvider>
  );
};

export default LeftSidebar;
