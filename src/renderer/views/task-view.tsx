import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { Brain, FileBracesCorner } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import ChatInterface from '@renderer/components/ChatInterface';
import { DiffViewer } from '@renderer/components/diff-viewer/DiffViewer';
import { EditorContent } from '@renderer/components/FileExplorer/CodeEditor';
import { FileTabs } from '@renderer/components/FileExplorer/FileTabs';
import { FileTree } from '@renderer/components/FileExplorer/FileTree';
import MultiAgentTask from '@renderer/components/MultiAgentTask';
import RightSidebar from '@renderer/components/RightSidebar';
import TaskCreationLoading from '@renderer/components/TaskCreationLoading';
import OpenInMenu from '@renderer/components/titlebar/OpenInMenu';
import { Titlebar } from '@renderer/components/titlebar/Titlebar';
import TitlebarContext from '@renderer/components/titlebar/TitlebarContext';
import { ToggleGroup, ToggleGroupItem } from '@renderer/components/ui/toggle-group';
import { DEFAULT_EXCLUDE_PATTERNS, isMarkdownFile } from '@renderer/constants/file-explorer';
import { useCodeEditorContext } from '@renderer/contexts/CodeEditorProvider';
import { ConversationsProvider } from '@renderer/contexts/ConversationsProvider';
import { useCurrentProject } from '@renderer/contexts/CurrentProjectProvider';
import { useCurrentTask } from '@renderer/contexts/CurrentTaskProvider';
import { useProjectManagementContext } from '@renderer/contexts/ProjectManagementProvider';
import { useTaskManagementContext } from '@renderer/contexts/TaskManagementProvider';
import { useTaskViewContext } from '@renderer/contexts/TaskViewProvider';
import { useWorkspaceNavigation } from '@renderer/contexts/WorkspaceNavigationContext';
import { useAutoPrRefresh } from '@renderer/hooks/useAutoPrRefresh';
import { useEditorDiffDecorations } from '@renderer/hooks/useEditorDiffDecorations';
import { useProjectBranchOptions } from '@renderer/hooks/useProjectBranchOptions';
import { useProjectRemoteInfo } from '@renderer/hooks/useProjectRemoteInfo';
import { useTheme } from '@renderer/hooks/useTheme';
import { registerActiveCodeEditor } from '@renderer/lib/activeCodeEditor';
import { getAgentForTask } from '@renderer/lib/getAgentForTask';
import {
  addMonacoKeyboardShortcuts,
  configureMonacoEditor,
  configureMonacoTypeScript,
} from '@renderer/lib/monaco-config';
import { applyMonacoTheme, defineMonacoThemes } from '@renderer/lib/monaco-themes';

export function TaskTitlebar() {
  const project = useCurrentProject();
  const task = useCurrentTask();
  const { projects } = useProjectManagementContext();
  const { tasksByProjectId } = useTaskManagementContext();
  const { navigate } = useWorkspaceNavigation();
  const { view, setView } = useTaskViewContext();

  const isTaskMultiAgent = Boolean(task?.metadata?.multiAgent?.enabled);
  const currentPath = isTaskMultiAgent
    ? null
    : task?.path || (project?.isRemote ? project?.remotePath : project?.path) || null;

  const projectWithTasks = project
    ? { ...project, tasks: tasksByProjectId[project.id] ?? project.tasks ?? [] }
    : null;

  return (
    <Titlebar
      leftSlot={
        <TitlebarContext
          projects={projects.map((p) => ({
            ...p,
            tasks: tasksByProjectId[p.id] ?? p.tasks ?? [],
          }))}
          selectedProject={projectWithTasks}
          activeTask={task}
          onSelectProject={(p) => navigate('project', { projectId: p.id })}
          onSelectTask={(t) => navigate('task', { projectId: t.projectId, taskId: t.id })}
        />
      }
      rightSlot={
        <>
          <ToggleGroup
            variant="outline"
            value={[view]}
            onValueChange={(value) => setView(value[0] as 'agents' | 'editor')}
          >
            <ToggleGroupItem value="agents">
              <Brain className="h-4 w-4" />
            </ToggleGroupItem>
            <ToggleGroupItem value="editor">
              <FileBracesCorner className="h-4 w-4" />
            </ToggleGroupItem>
          </ToggleGroup>

          {currentPath && (
            <OpenInMenu
              path={currentPath}
              align="right"
              isRemote={project?.isRemote || false}
              sshConnectionId={project?.sshConnectionId || null}
            />
          )}
        </>
      }
    />
  );
}

export function TaskMainPanel() {
  const project = useCurrentProject();
  const task = useCurrentTask();
  const { handleTaskInterfaceReady, handleRenameTask, isCreatingTask } = useTaskManagementContext();
  const { connectionId: projectRemoteConnectionId, remotePath: projectRemotePath } =
    useProjectRemoteInfo(project);
  const { projectDefaultBranch } = useProjectBranchOptions(project);
  const { view } = useTaskViewContext();

  if (!task || !project) {
    if (isCreatingTask) {
      return (
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="absolute inset-0 z-10 bg-background">
            <TaskCreationLoading />
          </div>
        </div>
      );
    }
    return <div className="flex flex-1 items-center justify-center text-muted-foreground" />;
  }

  const initialAgent = getAgentForTask(task) || undefined;
  const isMultiAgent = Boolean(task.metadata?.multiAgent?.enabled);

  switch (view) {
    case 'agents':
      return (
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          {isMultiAgent ? (
            <MultiAgentTask
              task={task}
              projectPath={project.path}
              projectRemoteConnectionId={projectRemoteConnectionId}
              projectRemotePath={projectRemotePath}
              defaultBranch={projectDefaultBranch}
              onTaskInterfaceReady={handleTaskInterfaceReady}
            />
          ) : (
            <ConversationsProvider taskId={task.id} initialAgent={initialAgent}>
              <ChatInterface
                task={task}
                project={project}
                projectName={project.name}
                projectPath={project.path}
                projectRemoteConnectionId={projectRemoteConnectionId}
                projectRemotePath={projectRemotePath}
                defaultBranch={projectDefaultBranch}
                className="min-h-0 flex-1"
                initialAgent={initialAgent}
                onTaskInterfaceReady={handleTaskInterfaceReady}
                onRenameTask={handleRenameTask}
              />
            </ConversationsProvider>
          )}
          {isCreatingTask && (
            <div className="absolute inset-0 z-10 bg-background">
              <TaskCreationLoading />
            </div>
          )}
        </div>
      );
    case 'editor':
      return <CodeEditorMainPanel />;
  }
}

interface DiffState {
  taskId: string;
  taskPath: string;
  initialFile?: string | null;
}

export function TaskRightSidebar() {
  const project = useCurrentProject();
  const task = useCurrentTask();
  const { connectionId: projectRemoteConnectionId, remotePath: projectRemotePath } =
    useProjectRemoteInfo(project);
  const { projectDefaultBranch } = useProjectBranchOptions(project);
  const [diffState, setDiffState] = useState<DiffState | null>(null);
  const { view } = useTaskViewContext();

  useAutoPrRefresh(task?.path);

  const handleOpenChanges = (filePath?: string, taskPath?: string) => {
    if (!task || !taskPath) return;
    setDiffState({ taskId: task.id, taskPath, initialFile: filePath ?? null });
  };

  switch (view) {
    case 'agents':
      return (
        <>
          <RightSidebar
            task={task}
            projectPath={project?.path || null}
            projectRemoteConnectionId={projectRemoteConnectionId}
            projectRemotePath={projectRemotePath}
            projectDefaultBranch={projectDefaultBranch}
            className="lg:border-l-0"
            onOpenChanges={handleOpenChanges}
          />
          <DialogPrimitive.Root
            open={!!diffState}
            onOpenChange={(open: boolean) => !open && setDiffState(null)}
          >
            <DialogPrimitive.Portal>
              <DialogPrimitive.Popup
                className="fixed inset-0 z-[200] bg-background focus:outline-none"
                aria-describedby={undefined}
              >
                <DialogPrimitive.Title className="sr-only">Diff Viewer</DialogPrimitive.Title>
                {diffState && (
                  <DiffViewer
                    taskId={diffState.taskId}
                    taskPath={diffState.taskPath}
                    initialFile={diffState.initialFile}
                    onClose={() => setDiffState(null)}
                  />
                )}
              </DialogPrimitive.Popup>
            </DialogPrimitive.Portal>
          </DialogPrimitive.Root>
        </>
      );
    case 'editor':
      return <CodeEditorFileTree />;
  }
}

function CodeEditorMainPanel() {
  const {
    openFiles,
    activeFilePath,
    activeFile,
    isSaving,
    previewMode,
    togglePreview,
    handleCloseFile,
    setActiveFile,
    saveFile,
    saveAllFiles,
    updateFileContent,
    taskPath,
    connectionId,
    remotePath,
  } = useCodeEditorContext();

  const { effectiveTheme } = useTheme();
  const monacoRef = useRef<any>(null);
  const editorRef = useRef<any>(null);
  const editorRegistrationCleanupRef = useRef<(() => void) | null>(null);
  const [editorReady, setEditorReady] = useState(false);
  const prevIsSaving = useRef(false);

  const { refreshDecorations } = useEditorDiffDecorations({
    editor: editorReady ? editorRef.current : null,
    filePath: activeFilePath || '',
    taskPath,
  });

  useEffect(() => {
    if (editorReady && editorRef.current && activeFilePath && refreshDecorations) {
      const timer = setTimeout(() => {
        refreshDecorations();
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [activeFilePath, editorReady, refreshDecorations, activeFile?.isDirty]);

  useEffect(() => {
    if (prevIsSaving.current && !isSaving && editorReady && refreshDecorations) {
      if (editorRef.current) {
        refreshDecorations(true);
      }
      const timer = setTimeout(() => {
        refreshDecorations(true);
      }, 800);
      prevIsSaving.current = false;
      return () => clearTimeout(timer);
    }
    prevIsSaving.current = isSaving;
  }, [isSaving, editorReady, refreshDecorations]);

  useEffect(() => {
    const initMonaco = async () => {
      const { loader } = await import('@monaco-editor/react');
      loader.init().then((monaco) => {
        if (!monacoRef.current) {
          monacoRef.current = monaco;
          configureMonacoTypeScript(monaco);
          defineMonacoThemes(monaco);
        }
      });
    };
    initMonaco();
  }, []);

  useEffect(() => {
    const applyTheme = async () => {
      const { loader } = await import('@monaco-editor/react');
      const monaco = await loader.init();
      applyMonacoTheme(monaco, effectiveTheme);
    };
    void applyTheme();
  }, [effectiveTheme]);

  const handleEditorMount = useCallback(
    (editor: any, monaco: any) => {
      editorRef.current = editor;
      editorRegistrationCleanupRef.current?.();
      editorRegistrationCleanupRef.current = registerActiveCodeEditor(editor);

      if (!monacoRef.current) {
        monacoRef.current = monaco;
        configureMonacoTypeScript(monaco);
      }

      defineMonacoThemes(monaco);
      configureMonacoEditor(editor);
      editor.updateOptions({ glyphMargin: true });

      addMonacoKeyboardShortcuts(editor, monaco, {
        onSave: async () => {
          await saveFile();
          setTimeout(() => {
            if (refreshDecorations) {
              refreshDecorations(true);
            }
          }, 700);
        },
        onSaveAll: saveAllFiles,
      });

      setEditorReady(true);
      setTimeout(() => {
        if (refreshDecorations) {
          refreshDecorations();
        }
      }, 100);
    },
    [saveFile, saveAllFiles, refreshDecorations]
  );

  useEffect(() => {
    return () => {
      editorRegistrationCleanupRef.current?.();
      editorRegistrationCleanupRef.current = null;
    };
  }, []);

  const handleEditorChange = useCallback(
    (value: string | undefined) => {
      if (!activeFilePath || value === undefined) return;
      updateFileContent(activeFilePath, value);
    },
    [activeFilePath, updateFileContent]
  );

  const isPreviewActive = activeFilePath
    ? (previewMode.get(activeFilePath) ?? isMarkdownFile(activeFilePath))
    : false;

  const modelRootPath = remotePath ? `${connectionId || 'remote'}:${remotePath}` : taskPath;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <FileTabs
        openFiles={openFiles}
        activeFilePath={activeFilePath}
        onTabClick={setActiveFile}
        onTabClose={handleCloseFile}
        previewMode={previewMode}
        onTogglePreview={togglePreview}
      />
      <EditorContent
        activeFile={activeFile}
        effectiveTheme={effectiveTheme}
        onEditorMount={handleEditorMount}
        onEditorChange={handleEditorChange}
        isPreviewActive={isPreviewActive}
        modelRootPath={modelRootPath}
        taskPath={taskPath}
      />
    </div>
  );
}

function CodeEditorFileTree() {
  const { taskId, taskPath, activeFilePath, loadFile, fileChanges, connectionId, remotePath } =
    useCodeEditorContext();

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <FileTree
        taskId={taskId}
        rootPath={taskPath}
        selectedFile={activeFilePath}
        onSelectFile={loadFile}
        onOpenFile={loadFile}
        className="flex-1 overflow-y-auto"
        showHiddenFiles={true}
        excludePatterns={DEFAULT_EXCLUDE_PATTERNS}
        fileChanges={fileChanges}
        connectionId={connectionId}
        remotePath={remotePath}
      />
    </div>
  );
}
