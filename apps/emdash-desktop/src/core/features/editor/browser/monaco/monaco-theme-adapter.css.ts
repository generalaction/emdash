import { hostStyle } from '@emdash/ui/styles/host';
import { monacoThemeIntegration } from './monaco-theme-integration';

/** Future desktop-root contribution; intentionally not applied before the atomic cutover. */
export const monacoThemeIntegrationClass = hostStyle(monacoThemeIntegration.writer);
