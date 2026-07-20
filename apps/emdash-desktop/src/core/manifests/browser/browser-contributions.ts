import { automationsBrowserContributions } from '@core/features/automations/contributions/browser';
import { conversationsBrowserContributions } from '@core/features/conversations/contributions/browser';
import { editorBrowserContributions } from '@core/features/editor/contributions/browser';
import { integrationsBrowserContributions } from '@core/features/integrations/contributions/browser';
import { libraryBrowserContributions } from '@core/features/library/contributions/browser';
import { machinesBrowserContributions } from '@core/features/machines/contributions/browser';
import { mcpBrowserContributions } from '@core/features/mcp/contributions/browser';
import { projectsBrowserContributions } from '@core/features/projects/contributions/browser';
import { settingsBrowserContributions } from '@core/features/settings/contributions/browser';
import { skillsBrowserContributions } from '@core/features/skills/contributions/browser';
import { sourceControlBrowserContributions } from '@core/features/source-control/contributions/browser';
import { tasksBrowserContributions } from '@core/features/tasks/contributions/browser';
import { workbenchBrowserContributions } from '@core/features/workbench/contributions/browser';

export const featureViewRuntimes = [
  ...workbenchBrowserContributions.views,
  ...automationsBrowserContributions.views,
  ...libraryBrowserContributions.views,
  ...mcpBrowserContributions.views,
  ...projectsBrowserContributions.views,
  ...settingsBrowserContributions.views,
  ...skillsBrowserContributions.views,
  ...tasksBrowserContributions.views,
] as const;

export const featureModalDefs = [
  ...conversationsBrowserContributions.modalDefs,
  ...editorBrowserContributions.modalDefs,
  ...integrationsBrowserContributions.modalDefs,
  ...libraryBrowserContributions.modalDefs,
  ...machinesBrowserContributions.modalDefs,
  ...projectsBrowserContributions.modalDefs,
  ...settingsBrowserContributions.modalDefs,
  ...skillsBrowserContributions.modalDefs,
  ...sourceControlBrowserContributions.modalDefs,
  ...tasksBrowserContributions.modalDefs,
  ...workbenchBrowserContributions.modalDefs,
] as const;
