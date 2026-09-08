import { hostStyle } from '@emdash/ui/styles/host';
import { xtermThemeIntegration } from './xterm-theme-integration';

/** Future desktop-root contribution; intentionally not applied before the atomic cutover. */
export const xtermThemeIntegrationClass = hostStyle(xtermThemeIntegration.writer);
