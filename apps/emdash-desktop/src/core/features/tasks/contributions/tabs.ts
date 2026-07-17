import { diffTabProvider } from '../browser/diff-view/diff-tab-provider';
import { fileTabProvider } from '../browser/editor/file-tab-provider';
import { terminalTabProvider } from '../browser/terminals/terminal-tab-provider';

export const taskTaskTabContributions = [
  fileTabProvider,
  diffTabProvider,
  terminalTabProvider,
] as const;
