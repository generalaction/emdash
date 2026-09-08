import { conversationsHostStylesContribution } from '@core/features/conversations/contributions/host-styles';
import { editorHostStylesContribution } from '@core/features/editor/contributions/host-styles';
import { sourceControlHostStylesContribution } from '@core/features/source-control/contributions/host-styles';
import { tasksHostStylesContribution } from '@core/features/tasks/contributions/host-styles';
import { terminalsHostStylesContribution } from '@core/features/terminals/contributions/host-styles';
import {
  DESKTOP_HOST_ROOT_ATTRIBUTE,
  desktopHostRootMarker,
} from '@core/primitives/styling/api/desktop-host-styles';
import { pullRequestsHostStylesContribution } from '@core/services/pull-requests/contributions/host-styles';

export const desktopHostStyleContributions = [
  conversationsHostStylesContribution,
  editorHostStylesContribution,
  pullRequestsHostStylesContribution,
  sourceControlHostStylesContribution,
  tasksHostStylesContribution,
  terminalsHostStylesContribution,
] as const;

export const desktopHostRootClassNames = [
  conversationsHostStylesContribution.exports.chatHostAdapterClassName,
  editorHostStylesContribution.exports.monacoThemeIntegrationClass,
  terminalsHostStylesContribution.exports.xtermThemeIntegrationClass,
] as const;

type DesktopHostRoot = Pick<HTMLElement, 'classList' | 'setAttribute'>;

/** Activates the complete desktop Host Styling Adapter on its owned document root. */
export function installDesktopHostStyles(root: DesktopHostRoot = document.documentElement): void {
  root.setAttribute(
    DESKTOP_HOST_ROOT_ATTRIBUTE,
    desktopHostRootMarker[DESKTOP_HOST_ROOT_ATTRIBUTE]
  );
  root.classList.add(...desktopHostRootClassNames);
}
