/**
 * Monaco Diff Editor Configuration
 *
 *
 * This configuration is specifically for diff viewers where:
 * - Code is read-only (viewing changes, not editing)
 * - Worktrees may lack dependencies (no node_modules)
 * - Diff context may show partial/incomplete code
 */

import type * as monaco from 'monaco-editor';

/**
 * Error codes to suppress in diff viewers (if using targeted suppression)
 * Currently unused as we disable all validation, but kept for future reference
 */
const DIFF_VIEWER_IGNORED_DIAGNOSTICS = [
  2307, // Cannot find module
  2792, // Cannot find module (path aliases)
  2304, // Cannot find name (global types)
  1005, // ':' expected
  2365, // Operator '<' cannot be applied (JSX confusion)
  17004, // Cannot use JSX unless '--jsx' flag provided
  1161, // Unterminated regular expression literal
  1003, // Identifier expected
  1109, // Expression expected
  1160, // Unterminated template literal
];

/**
 * Configures a Monaco diff editor instance to suppress common validation warnings
 *
 * @param editor - The Monaco diff editor instance
 * @param monaco - The Monaco namespace
 * @param options - Configuration options
 */
export function configureDiffEditorDiagnostics(
  editor: monaco.editor.IStandaloneDiffEditor,
  monaco: any,
  options: {
    /** Completely disable validation (aggressive but effective) */
    disableAllValidation?: boolean;
    /** Only suppress specific error codes (more targeted) */
    suppressSpecificErrors?: boolean;
  } = {}
): void {
  const { disableAllValidation = false, suppressSpecificErrors = true } = options;

  // Get the modified editor (right side) which is where users review changes
  const modifiedEditor = editor.getModifiedEditor();
  const model = modifiedEditor.getModel();

  if (!model) return;

  // Create diagnostic options based on configuration
  const diagnosticOptions = {
    noSemanticValidation: disableAllValidation,
    noSyntaxValidation: disableAllValidation,
    diagnosticCodesToIgnore: suppressSpecificErrors ? DIFF_VIEWER_IGNORED_DIAGNOSTICS : [],
  };

  // Apply configuration to this specific model's language
  const language = model.getLanguageId();

  if (language === 'typescript' || language === 'typescriptreact') {
    // For TypeScript files, we need to configure the language service
    // Note: This still affects global defaults, but we limit it to when diff viewers are used
    monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions(diagnosticOptions);
  } else if (language === 'javascript' || language === 'javascriptreact') {
    // For JavaScript files
    monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions(diagnosticOptions);
  }

  try {
    // @ts-expect-error - This API might not exist in older versions
    if (monaco.editor.setModelMarkers) {
      // Clear existing markers for this model
      monaco.editor.setModelMarkers(model, 'typescript', []);
    }
  } catch {
    // Older Monaco version, ignore
  }
}

/**
 * Resets diagnostic options to defaults (for cleanup)
 * Call this when closing diff modals to restore normal validation
 */
export function resetDiagnosticOptions(monaco: any): void {
  const defaultOptions = {
    noSemanticValidation: false,
    noSyntaxValidation: false,
    diagnosticCodesToIgnore: [],
  };

  if (monaco?.languages?.typescript?.typescriptDefaults) {
    monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions(defaultOptions);
  }

  if (monaco?.languages?.typescript?.javascriptDefaults) {
    monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions(defaultOptions);
  }
}
