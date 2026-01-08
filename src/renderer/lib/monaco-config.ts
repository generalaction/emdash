/**
 * Monaco Editor configuration for TypeScript/JavaScript support
 * Configures language services to match project's tsconfig.json
 */

// TypeScript target and module constants
const TYPESCRIPT_TARGETS = {
  ES2020: 99, // Monaco's ES2020 enum value
};

const MODULE_KINDS = {
  ESNext: 99,
};

const MODULE_RESOLUTIONS = {
  NodeJs: 2,
};

const JSX_EMIT = {
  React: 2,
  ReactJSX: 4,
};

// Diagnostic codes to ignore for cleaner editor experience
const DIAGNOSTIC_CODES_TO_IGNORE = [
  2307, // Cannot find module (for project-specific imports)
  2792, // Cannot find module (for path aliases)
  2304, // Cannot find name (for global types)
  1149, // File name differs from already included file (case sensitivity)
];

// TypeScript compiler options matching tsconfig.json
const TYPESCRIPT_COMPILER_OPTIONS = {
  target: TYPESCRIPT_TARGETS.ES2020,
  lib: ['es2020', 'dom', 'dom.iterable'],
  allowJs: false,
  skipLibCheck: true,
  esModuleInterop: true,
  allowSyntheticDefaultImports: true,
  strict: true,
  forceConsistentCasingInFileNames: true,
  module: MODULE_KINDS.ESNext,
  moduleResolution: MODULE_RESOLUTIONS.NodeJs,
  resolveJsonModule: true,
  isolatedModules: true,
  noEmit: true,
  jsx: JSX_EMIT.ReactJSX,
  baseUrl: '.',
  paths: {
    '@/*': ['./src/renderer/*'],
    '@shared/*': ['./src/shared/*'],
    '#types/*': ['./src/types/*'],
    '#types': ['./src/types/index.ts'],
  },
  typeRoots: ['./node_modules/@types'],
  types: ['react', 'react-dom', 'node'],
};

// JavaScript compiler options
const JAVASCRIPT_COMPILER_OPTIONS = {
  target: TYPESCRIPT_TARGETS.ES2020,
  lib: ['es2020', 'dom', 'dom.iterable'],
  allowJs: true,
  checkJs: false,
  jsx: JSX_EMIT.React,
  module: MODULE_KINDS.ESNext,
  moduleResolution: MODULE_RESOLUTIONS.NodeJs,
};

// Diagnostics options for better error reporting
const DIAGNOSTICS_OPTIONS = {
  noSemanticValidation: false,
  noSyntaxValidation: false,
  diagnosticCodesToIgnore: DIAGNOSTIC_CODES_TO_IGNORE,
};

/**
 * Configure Monaco editor's TypeScript language services
 * @param monaco - Monaco editor instance
 */
export function configureMonacoTypeScript(monaco: any): void {
  try {
    configureTypeScriptDefaults(monaco);
    configureJavaScriptDefaults(monaco);
  } catch (error) {
    console.warn('Failed to configure Monaco TypeScript settings:', error);
  }
}

/**
 * Configure TypeScript language defaults
 */
function configureTypeScriptDefaults(monaco: any): void {
  if (!monaco?.languages?.typescript?.typescriptDefaults) {
    return;
  }

  const tsDefaults = monaco.languages.typescript.typescriptDefaults;

  // Apply compiler options with safe fallbacks
  const compilerOptions = { ...TYPESCRIPT_COMPILER_OPTIONS };

  // Use Monaco's enum values if available, otherwise use numeric fallbacks
  if (monaco.languages.typescript.ScriptTarget?.ES2020) {
    compilerOptions.target = monaco.languages.typescript.ScriptTarget.ES2020;
  }
  if (monaco.languages.typescript.ModuleKind?.ESNext) {
    compilerOptions.module = monaco.languages.typescript.ModuleKind.ESNext;
  }
  if (monaco.languages.typescript.ModuleResolutionKind?.NodeJs) {
    compilerOptions.moduleResolution = monaco.languages.typescript.ModuleResolutionKind.NodeJs;
  }
  if (monaco.languages.typescript.JsxEmit?.ReactJSX) {
    compilerOptions.jsx = monaco.languages.typescript.JsxEmit.ReactJSX;
  }

  tsDefaults.setCompilerOptions(compilerOptions);
  tsDefaults.setDiagnosticsOptions(DIAGNOSTICS_OPTIONS);
  tsDefaults.setEagerModelSync(true);
}

/**
 * Configure JavaScript language defaults
 */
function configureJavaScriptDefaults(monaco: any): void {
  if (!monaco?.languages?.typescript?.javascriptDefaults) {
    return;
  }

  const jsDefaults = monaco.languages.typescript.javascriptDefaults;

  // Apply compiler options with safe fallbacks
  const compilerOptions = { ...JAVASCRIPT_COMPILER_OPTIONS };

  // Use Monaco's enum values if available
  if (monaco.languages.typescript.ScriptTarget?.ES2020) {
    compilerOptions.target = monaco.languages.typescript.ScriptTarget.ES2020;
  }
  if (monaco.languages.typescript.ModuleKind?.ESNext) {
    compilerOptions.module = monaco.languages.typescript.ModuleKind.ESNext;
  }
  if (monaco.languages.typescript.ModuleResolutionKind?.NodeJs) {
    compilerOptions.moduleResolution = monaco.languages.typescript.ModuleResolutionKind.NodeJs;
  }
  if (monaco.languages.typescript.JsxEmit?.React) {
    compilerOptions.jsx = monaco.languages.typescript.JsxEmit.React;
  }

  jsDefaults.setCompilerOptions(compilerOptions);
  jsDefaults.setEagerModelSync(true);
}

/**
 * Configure Monaco editor instance options
 * @param editor - Monaco editor instance
 * @param monaco - Monaco namespace
 */
export function configureMonacoEditor(editor: any, monaco: any): void {
  editor.updateOptions({
    quickSuggestions: {
      other: true,
      comments: false,
      strings: true,
    },
    suggestOnTriggerCharacters: true,
    parameterHints: {
      enabled: true,
    },
    wordBasedSuggestions: false,
    suggest: {
      showKeywords: true,
      showSnippets: true,
      showClasses: true,
      showFunctions: true,
      showVariables: true,
    },
  });
}

/**
 * Add keyboard shortcuts to editor
 * @param editor - Monaco editor instance
 * @param monaco - Monaco namespace
 * @param handlers - Keyboard shortcut handlers
 */
export function addMonacoKeyboardShortcuts(
  editor: any,
  monaco: any,
  handlers: {
    onSave?: () => void;
    onSaveAll?: () => void;
  }
): void {
  if (handlers.onSave) {
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, handlers.onSave);
  }

  if (handlers.onSaveAll) {
    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyS,
      handlers.onSaveAll
    );
  }
}
