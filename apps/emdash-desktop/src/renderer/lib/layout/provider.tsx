import { reaction } from 'mobx';
import { observer } from 'mobx-react-lite';
import { useEffect, type ReactNode } from 'react';
import { viewCatalog } from '@core/manifests/browser/view-catalog';
import type { ViewRef } from '@core/primitives/views/api';
import { appState } from '@renderer/lib/stores/app-state';
import { focusTracker } from '@renderer/utils/focus-tracker';
import { clearTelemetryTaskScope, setTelemetryTaskScope } from '@renderer/utils/telemetry-scope';
import { captureTelemetry } from '@renderer/utils/telemetryClient';

function syncTelemetryScope(ref: ViewRef): void {
  if (ref.viewId !== 'task') {
    clearTelemetryTaskScope();
    return;
  }

  const taskParams = ref.params as { projectId?: unknown; taskId?: unknown };
  if (
    taskParams &&
    typeof taskParams.projectId === 'string' &&
    typeof taskParams.taskId === 'string'
  ) {
    setTelemetryTaskScope({ projectId: taskParams.projectId, taskId: taskParams.taskId });
    return;
  }

  clearTelemetryTaskScope();
}

export const WorkspaceViewProvider = observer(function WorkspaceViewProvider({
  children,
}: {
  children: ReactNode;
}) {
  useEffect(() => {
    const initialViewId = appState.navigation.currentViewId;
    focusTracker.initialize({ view: initialViewId });
    syncTelemetryScope(appState.navigation.currentRef);
    const event = viewCatalog.byId(initialViewId)?.telemetryEvent;
    if (event) captureTelemetry(event, { from_view: null });
  }, []);

  useEffect(() => {
    return reaction(
      () => appState.navigation.currentRef,
      (ref) => syncTelemetryScope(ref)
    );
  }, []);

  return <>{children}</>;
});
