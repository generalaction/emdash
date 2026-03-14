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
