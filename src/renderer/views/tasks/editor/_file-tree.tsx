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
