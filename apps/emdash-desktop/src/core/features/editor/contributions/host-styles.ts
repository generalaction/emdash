import { defineDesktopHostStyleContribution } from '@core/primitives/styling/api/desktop-host-styles';
import { monacoThemeIntegrationClass } from '../browser/monaco/monaco-theme-adapter.css';

/** Feature-owned Monaco contribution installed on the desktop host root. */
export const editorHostStylesContribution = defineDesktopHostStyleContribution({
  id: 'editor-monaco',
  exports: {
    monacoThemeIntegrationClass,
  },
});
