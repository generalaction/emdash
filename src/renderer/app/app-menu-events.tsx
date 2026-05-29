import { when } from 'mobx';
import { useEffect } from 'react';
import { getTaskView } from '@renderer/features/tasks/stores/task-selectors';
import { events, rpc } from '@renderer/lib/ipc';
import { useNavigate, useWorkspaceSlots } from '@renderer/lib/layout/navigation-provider';
import { toggleSettingsView } from '@renderer/lib/layout/settings-toggle';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import {
  appDeepLinkChannel,
  type AppDeepLinkEvent,
  menuGiveFeedbackChannel,
  menuOpenSettingsChannel,
  menuQuitRequestedChannel,
  notificationFocusTaskChannel,
} from '@shared/events/appEvents';
import type { Issue } from '@shared/tasks';

const ISSUE_CONTEXT_TIMEOUT_MS = 2_000;

function buildIssueFromDeepLink(deepLink: AppDeepLinkEvent): Issue {
  const { issue } = deepLink;
  return {
    provider: 'linear',
    identifier: issue.identifier,
    url: issue.url ?? '',
    title: issue.title ?? issue.identifier,
    description: issue.description,
    branchName: issue.branchName,
  };
}

async function resolveLinearIssueFromDeepLink(deepLink: AppDeepLinkEvent): Promise<Issue> {
  const fallbackIssue = buildIssueFromDeepLink(deepLink);

  const result = await Promise.race([
    rpc.issues.getIssueContext('linear', { identifier: deepLink.issue.identifier }),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ISSUE_CONTEXT_TIMEOUT_MS)),
  ]).catch(() => null);

  if (!result?.success) return fallbackIssue;

  return {
    ...fallbackIssue,
    ...result.issue,
    url: result.issue.url || fallbackIssue.url,
    title: result.issue.title || fallbackIssue.title,
  };
}

export function AppMenuEvents({ onOpenSettings }: { onOpenSettings?: () => boolean | void }) {
  const { navigate } = useNavigate();
  const { currentView, lastNonSettingsView } = useWorkspaceSlots();
  const showConfirmQuitModal = useShowModal('confirmActionModal');
  const showFeedbackModal = useShowModal('feedbackModal');
  const showTaskModal = useShowModal('taskModal');

  useEffect(() => {
    let disposed = false;

    const handleDeepLink = (deepLink: AppDeepLinkEvent) => {
      if (deepLink.type !== 'linear-agent') return;

      void resolveLinearIssueFromDeepLink(deepLink).then((issue) => {
        if (disposed) return;
        showTaskModal({
          strategy: 'from-issue',
          projectId: deepLink.projectId,
          initialIssue: issue,
          initialAgentProvider: deepLink.agentProvider,
          initialPrompt: deepLink.prompt,
        });
      });
    };

    const unlisten = events.on(appDeepLinkChannel, handleDeepLink);

    void rpc.app.drainPendingDeepLinks().then((deepLinks) => {
      if (disposed) return;
      deepLinks.forEach(handleDeepLink);
    });

    return () => {
      disposed = true;
      unlisten();
    };
  }, [showTaskModal]);

  useEffect(() => {
    return events.on(menuOpenSettingsChannel, () => {
      if (currentView !== 'settings') {
        const shouldOpen = onOpenSettings?.() ?? true;
        if (shouldOpen === false) return;
      }

      toggleSettingsView(navigate, currentView, lastNonSettingsView);
    });
  }, [navigate, onOpenSettings, currentView, lastNonSettingsView]);

  useEffect(() => {
    return events.on(menuQuitRequestedChannel, () => {
      showConfirmQuitModal({
        title: 'Quit Emdash?',
        description: 'Active terminal sessions and running agents will stop when the app quits.',
        confirmLabel: 'Quit',
        onSuccess: () => {
          void rpc.app.quit();
        },
      });
    });
  }, [showConfirmQuitModal]);

  useEffect(() => {
    return events.on(menuGiveFeedbackChannel, () => {
      showFeedbackModal({});
    });
  }, [showFeedbackModal]);

  useEffect(() => {
    const disposers = new Set<() => void>();

    const unlisten = events.on(
      notificationFocusTaskChannel,
      ({ projectId, taskId, conversationId }) => {
        navigate('task', { projectId, taskId });
        if (!conversationId) return;

        // Task view may not be provisioned yet — wait for it before opening the conversation tab.
        const dispose = when(
          () => !!getTaskView(projectId, taskId),
          () => {
            getTaskView(projectId, taskId)?.tabGroupManager.openConversation(conversationId);
          },
          {
            timeout: 10_000,
          }
        );

        disposers.add(dispose);
      }
    );

    return () => {
      unlisten();
      disposers.forEach((dispose) => dispose());
      disposers.clear();
    };
  }, [navigate]);

  return null;
}
