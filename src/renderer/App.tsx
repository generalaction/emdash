import React, { useState, useEffect } from "react";
import { Button } from "./components/ui/button";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";

import { FolderOpen } from "lucide-react";
import LeftSidebar from "./components/LeftSidebar";
import ProjectMainView from "./components/ProjectMainView";
import WorkspaceModal from "./components/WorkspaceModal";
import ChatInterface from "./components/ChatInterface";
import WorkspaceTerminalPanel from "./components/WorkspaceTerminalPanel";
import FileChangesPanel from "./components/FileChangesPanel";
import { Toaster } from "./components/ui/toaster";
import { useToast } from "./hooks/use-toast";
import { useGithubAuth } from "./hooks/useGithubAuth";
import emdashLogo from "../assets/images/emdash/emdash_logo.svg";

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
}

interface Workspace {
  id: string;
  name: string;
  branch: string;
  path: string;
  status: "active" | "idle" | "running";
  agentId?: string;
}

const App: React.FC = () => {
  const { toast } = useToast();
  const [version, setVersion] = useState<string>("");
  const [platform, setPlatform] = useState<string>("");
  const {
    installed: ghInstalled,
    authenticated: isAuthenticated,
    user,
    isLoading,
    login: handleGitHubAuth,
    logout: handleLogout,
    checkStatus,
  } = useGithubAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [showWorkspaceModal, setShowWorkspaceModal] = useState<boolean>(false);
  const [showHomeView, setShowHomeView] = useState<boolean>(true);
  const [isCreatingWorkspace, setIsCreatingWorkspace] =
    useState<boolean>(false);
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace | null>(
    null
  );
  const [isCodexInstalled, setIsCodexInstalled] = useState<boolean | null>(null);
  const showGithubRequirement = !ghInstalled || !isAuthenticated;
  const showCodexRequirement = isCodexInstalled === false;

  // Persist and apply custom project order (by id)
  const ORDER_KEY = "sidebarProjectOrder";
  const applyProjectOrder = (list: Project[]) => {
    try {
      const raw = localStorage.getItem(ORDER_KEY);
      if (!raw) return list;
      const order: string[] = JSON.parse(raw);
      const indexOf = (id: string) => {
        const idx = order.indexOf(id);
        return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
      };
      return [...list].sort((a, b) => indexOf(a.id) - indexOf(b.id));
    } catch {
      return list;
    }
  };
  const saveProjectOrder = (list: Project[]) => {
    try {
      const ids = list.map((p) => p.id);
      localStorage.setItem(ORDER_KEY, JSON.stringify(ids));
    } catch {}
  };

  useEffect(() => {
    const loadAppData = async () => {
      try {
        const [appVersion, appPlatform, projects] = await Promise.all([
          window.electronAPI.getVersion(),
          window.electronAPI.getPlatform(),
          window.electronAPI.getProjects(),
        ]);

        setVersion(appVersion);
        setPlatform(appPlatform);
        setProjects(applyProjectOrder(projects));

        // Non-blocking: refresh GH status via hook
        checkStatus();

        const projectsWithWorkspaces = await Promise.all(
          projects.map(async (project) => {
            const workspaces = await window.electronAPI.getWorkspaces(
              project.id
            );
            return { ...project, workspaces };
          })
        );
        const ordered = applyProjectOrder(projectsWithWorkspaces);
        setProjects(ordered);

        const codexStatus = await window.electronAPI.codexCheckInstallation();
        if (codexStatus.success) {
          setIsCodexInstalled(
            codexStatus.isInstalled ?? false
          );
        } else {
          setIsCodexInstalled(false);
          console.error(
            "Failed to check Codex CLI installation:",
            codexStatus.error
          );
        }
      } catch (error) {
        console.error("Failed to load app data:", error);
      }
    };

    loadAppData();
  }, []);

  // handleGitHubAuth, handleLogout come from hook; toasts handled by callers as needed

  const handleOpenProject = async () => {
    try {
      const result = await window.electronAPI.openProject();
      if (result.success && result.path) {
        try {
          const gitInfo = await window.electronAPI.getGitInfo(result.path);
          if (gitInfo.isGitRepo) {
            if (isAuthenticated) {
              const githubInfo = await window.electronAPI.connectToGitHub(
                result.path
              );
              if (githubInfo.success) {
                const projectName =
                  result.path.split("/").pop() || "Unknown Project";
                const newProject: Project = {
                  id: Date.now().toString(),
                  name: projectName,
                  path: result.path,
                  gitInfo: {
                    isGitRepo: true,
                    remote: gitInfo.remote || undefined,
                    branch: gitInfo.branch || undefined,
                  },
                  githubInfo: {
                    repository: githubInfo.repository || "",
                    connected: true,
                  },
                  workspaces: [],
                };

                // Save to database
                const saveResult = await window.electronAPI.saveProject(
                  newProject
                );
                if (saveResult.success) {
                  setProjects((prev) => [...prev, newProject]);
                  setSelectedProject(newProject);
                } else {
                  console.error("Failed to save project:", saveResult.error);
                }
                // alert(`✅ Project connected to GitHub!\n\nRepository: ${githubInfo.repository}\nBranch: ${githubInfo.branch}\nPath: ${result.path}`);
              } else {
                const updateHint =
                  platform === "darwin"
                    ? "Tip: Update GitHub CLI with: brew upgrade gh — then restart emdash."
                    : platform === "win32"
                    ? "Tip: Update GitHub CLI with: winget upgrade GitHub.cli — then restart emdash."
                    : "Tip: Update GitHub CLI via your package manager (e.g., apt/dnf) and restart emdash.";
                toast({
                  title: "GitHub Connection Failed",
                  description: `Git repository detected but couldn't connect to GitHub: ${githubInfo.error}\n\n${updateHint}`,
                  variant: "destructive",
                });
              }
            } else {
              // User not authenticated - still save the project
              const projectName =
                result.path.split("/").pop() || "Unknown Project";
              const newProject: Project = {
                id: Date.now().toString(),
                name: projectName,
                path: result.path,
                gitInfo: {
                  isGitRepo: true,
                  remote: gitInfo.remote || undefined,
                  branch: gitInfo.branch || undefined,
                },
                githubInfo: {
                  repository: "",
                  connected: false,
                },
                workspaces: [],
              };

              // Save to database
              const saveResult = await window.electronAPI.saveProject(
                newProject
              );
              if (saveResult.success) {
                setProjects((prev) => [...prev, newProject]);
                setSelectedProject(newProject);
              } else {
                console.error("Failed to save project:", saveResult.error);
              }
            }
          } else {
            // Not a Git repository
            toast({
              title: "Project Opened",
              description: `This directory is not a Git repository. Path: ${result.path}`,
              variant: "destructive",
            });
          }
        } catch (error) {
          console.error("Git detection error:", error);
          toast({
            title: "Project Opened",
            description: `Could not detect Git information. Path: ${result.path}`,
            variant: "destructive",
          });
        }
      } else if (result.error) {
        toast({
          title: "Failed to Open Project",
          description: result.error,
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Open project error:", error);
      toast({
        title: "Failed to Open Project",
        description: "Please check the console for details.",
        variant: "destructive",
      });
    }
  };

  const handleCreateWorkspace = async (workspaceName: string) => {
    if (!selectedProject) return;

    setIsCreatingWorkspace(true);
    try {
      // Create Git worktree
      const worktreeResult = await window.electronAPI.worktreeCreate({
        projectPath: selectedProject.path,
        workspaceName,
        projectId: selectedProject.id,
      });

      if (!worktreeResult.success) {
        throw new Error(worktreeResult.error || "Failed to create worktree");
      }

      const worktree = worktreeResult.worktree;

      const newWorkspace: Workspace = {
        id: worktree.id,
        name: workspaceName,
        branch: worktree.branch,
        path: worktree.path,
        status: "idle",
      };

      // Save workspace to database
      const saveResult = await window.electronAPI.saveWorkspace({
        ...newWorkspace,
        projectId: selectedProject.id,
      });

      if (saveResult.success) {
        setProjects((prev) =>
          prev.map((project) =>
            project.id === selectedProject.id
              ? {
                  ...project,
                  workspaces: [...(project.workspaces || []), newWorkspace],
                }
              : project
          )
        );

        setSelectedProject((prev) =>
          prev
            ? {
                ...prev,
                workspaces: [...(prev.workspaces || []), newWorkspace],
              }
            : null
        );

        toast({
          title: "Workspace Created",
          description: `"${workspaceName}" workspace created successfully!`,
        });
      } else {
        console.error("Failed to save workspace:", saveResult.error);
        toast({
          title: "Error",
          description:
            "Failed to create workspace. Please check the console for details.",
        });
      }
    } catch (error) {
      console.error("Failed to create workspace:", error);
      toast({
        title: "Error",
        description: (error as Error)?.message ||
          "Failed to create workspace. Please check the console for details.",
      });
    } finally {
      setIsCreatingWorkspace(false);
    }
  };

  const handleGoHome = () => {
    setSelectedProject(null);
    setShowHomeView(true);
  };

  const handleSelectProject = (project: Project) => {
    setSelectedProject(project);
    setShowHomeView(false);
    setActiveWorkspace(null);
  };

  const handleSelectWorkspace = (workspace: Workspace) => {
    setActiveWorkspace(workspace);
  };

  const handleDeleteWorkspace = async (
    targetProject: Project,
    workspace: Workspace
  ) => {
    try {
      try {
        if (workspace.agentId) {
          const agentRemoval = await window.electronAPI.codexRemoveAgent(
            workspace.id
          );
          if (!agentRemoval.success) {
            console.warn(
              "codexRemoveAgent reported failure:",
              agentRemoval.error
            );
          }
        }
      } catch (agentError) {
        console.warn("Failed to remove agent before deleting workspace:", agentError);
      }

      const removeResult = await window.electronAPI.worktreeRemove({
        projectPath: targetProject.path,
        worktreeId: workspace.id,
        worktreePath: workspace.path,
        branch: workspace.branch,
      });
      if (!removeResult.success) {
        throw new Error(removeResult.error || "Failed to remove worktree");
      }

      const result = await window.electronAPI.deleteWorkspace(workspace.id);
      if (!result.success) {
        throw new Error(result.error || "Failed to delete workspace");
      }

      setProjects((prev) =>
        prev.map((project) =>
          project.id === targetProject.id
            ? {
                ...project,
                workspaces: (project.workspaces || []).filter(
                  (w) => w.id !== workspace.id
                ),
              }
            : project
        )
      );

      setSelectedProject((prev) =>
        prev && prev.id === targetProject.id
          ? {
              ...prev,
              workspaces: (prev.workspaces || []).filter(
                (w) => w.id !== workspace.id
              ),
            }
          : prev
      );

      if (activeWorkspace?.id === workspace.id) {
        setActiveWorkspace(null);
      }

      toast({
        title: "Workspace deleted",
        description: `"${workspace.name}" was removed.`,
      });
    } catch (error) {
      console.error("Failed to delete workspace:", error);
      toast({
        title: "Error",
        description:
          error instanceof Error
            ? error.message
            : "Could not delete workspace. Check the console for details.",
        variant: "destructive",
      });
    }
  };

  const handleReorderProjects = (sourceId: string, targetId: string) => {
    setProjects((prev) => {
      const list = [...prev];
      const fromIdx = list.findIndex((p) => p.id === sourceId);
      const toIdx = list.findIndex((p) => p.id === targetId);
      if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return prev;
      const [moved] = list.splice(fromIdx, 1);
      list.splice(toIdx, 0, moved);
      saveProjectOrder(list);
      return list;
    });
  };

  const needsGhInstall = !ghInstalled;
  const needsGhAuth = ghInstalled && !isAuthenticated;

  const handleReorderProjectsFull = (newOrder: Project[]) => {
    setProjects(() => {
      const list = [...newOrder];
      saveProjectOrder(list);
      return list;
    });
  };

  return (
    <div className="h-screen bg-background text-foreground">
      <PanelGroup direction="horizontal" className="h-full">
        <Panel defaultSize={20} minSize={15} maxSize={30}>
          <LeftSidebar
            projects={projects}
            selectedProject={selectedProject}
            onSelectProject={handleSelectProject}
            onGoHome={handleGoHome}
            onSelectWorkspace={handleSelectWorkspace}
            activeWorkspace={activeWorkspace || undefined}
            onReorderProjects={handleReorderProjects}
            onReorderProjectsFull={handleReorderProjectsFull}
            githubInstalled={ghInstalled}
            githubAuthenticated={isAuthenticated}
            githubUser={user}
          />
        </Panel>

        <PanelResizeHandle className="w-0.5 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors" />

        <Panel defaultSize={80}>
          {showHomeView ? (
            <div className="flex-1 bg-background text-foreground overflow-y-auto">
              <div className="container mx-auto px-4 py-8 flex flex-col justify-center min-h-screen">
                <div className="text-center mb-12">
                  <div className="flex items-center justify-center mb-4">
                    <div className="logo-shimmer-container">
                      <img
                        src={emdashLogo}
                        alt="emdash"
                        className="logo-shimmer-image"
                      />
                      <span
                        className="logo-shimmer-overlay"
                        aria-hidden="true"
                        style={{
                          WebkitMaskImage: `url(${emdashLogo})`,
                          maskImage: `url(${emdashLogo})`,
                          WebkitMaskRepeat: "no-repeat",
                          maskRepeat: "no-repeat",
                          WebkitMaskSize: "contain",
                          maskSize: "contain",
                          WebkitMaskPosition: "center",
                          maskPosition: "center",
                        }}
                      />
                    </div>
                  </div>
                  <p className="text-sm sm:text-base text-gray-700 text-muted-foreground mb-6">
                    Run multiple Codex Agents in parallel
                  </p>
                  <div className="text-sm text-gray-500 max-w-2xl mx-auto space-y-4">
                    {showGithubRequirement && (
                      <div>
                        <p className="mb-2">
                          <strong>Requirements:</strong> GitHub CLI
                        </p>
                        {needsGhInstall ? (
                          <p className="text-xs">
                            Install:{" "}
                            <code className="bg-gray-100 px-1 rounded">
                              brew install gh
                            </code>
                          </p>
                        ) : (
                          needsGhAuth && (
                            <p className="text-xs">
                              Authenticate:{" "}
                              <code className="bg-gray-100 px-1 rounded">
                                gh auth login
                              </code>
                            </p>
                          )
                        )}
                      </div>
                    )}

                    {showCodexRequirement && (
                      <div>
                        <p className="mb-2">
                          <strong>Requirements:</strong> Codex CLI
                        </p>
                        <div className="text-xs space-y-1">
                          <p>
                            Install:{" "}
                            <code className="bg-gray-100 px-1 rounded">
                              npm install -g @openai/codex
                            </code>
                          </p>
                          <p>
                            Authenticate:{" "}
                            <code className="bg-gray-100 px-1 rounded">
                              codex auth login
                            </code>
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-4 justify-center mb-8">
                  <Button
                    onClick={handleOpenProject}
                    size="lg"
                    className="min-w-[200px] bg-black text-white hover:bg-gray-800 hover:text-white border-black rounded-xl"
                  >
                    <FolderOpen className="mr-2 h-5 w-5" />
                    Open Project
                  </Button>
                </div>
              </div>
            </div>
          ) : selectedProject ? (
            activeWorkspace ? (
              <PanelGroup direction="horizontal" className="h-full">
                <Panel defaultSize={70} minSize={50}>
                  <ChatInterface
                    workspace={activeWorkspace}
                    projectName={selectedProject.name}
                    className="h-full"
                  />
                </Panel>

                <PanelResizeHandle className="w-0.5 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors" />

                <Panel defaultSize={30} minSize={20} maxSize={50}>
                  <PanelGroup direction="vertical" className="h-full">
                    <Panel defaultSize={50} minSize={30}>
                      <FileChangesPanel
                        workspaceId={activeWorkspace.path}
                        className="h-full rounded-tr-xl"
                      />
                    </Panel>

                    <PanelResizeHandle className="h-0.5 bg-gray-300 dark:bg-gray-600 hover:bg-gray-400 dark:hover:bg-gray-500 transition-colors" />

                    <Panel defaultSize={50} minSize={30}>
                      <WorkspaceTerminalPanel
                        workspace={activeWorkspace}
                        className="h-full rounded-br-xl"
                      />
                    </Panel>
                  </PanelGroup>
                </Panel>
              </PanelGroup>
            ) : (
              <ProjectMainView
                project={selectedProject}
                onCreateWorkspace={() => setShowWorkspaceModal(true)}
                activeWorkspace={activeWorkspace}
                onSelectWorkspace={handleSelectWorkspace}
                onDeleteWorkspace={handleDeleteWorkspace}
                isCreatingWorkspace={isCreatingWorkspace}
              />
            )
          ) : null}
        </Panel>
      </PanelGroup>

      <WorkspaceModal
        isOpen={showWorkspaceModal}
        onClose={() => setShowWorkspaceModal(false)}
        onCreateWorkspace={handleCreateWorkspace}
        projectName={selectedProject?.name || ""}
        defaultBranch={selectedProject?.gitInfo.branch || "main"}
        existingNames={(selectedProject?.workspaces || []).map((w) => w.name)}
      />
      <Toaster />
    </div>
  );
};

export default App;
