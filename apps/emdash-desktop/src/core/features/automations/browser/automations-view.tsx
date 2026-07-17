import { type ReactNode } from 'react';
import { automationsViewDef } from '@core/features/automations/contributions/views';
import { defineViewRuntime } from '@core/primitives/views/react';
import { Titlebar } from '@renderer/lib/components/titlebar/Titlebar';
import { AutomationsBreadcrumb } from './components/AutomationsBreadcrumb';
import { AutomationsView } from './components/AutomationsView';

export function AutomationsViewWrapper({
  children,
  automationId: _automationId,
}: {
  children: ReactNode;
  automationId?: string;
}) {
  return <>{children}</>;
}

export function AutomationsTitlebar() {
  return <Titlebar leftSlot={<AutomationsBreadcrumb />} />;
}

export function AutomationsMainPanel() {
  return <AutomationsView />;
}

export const automationsViewRuntime = defineViewRuntime(automationsViewDef, {
  slots: {
    wrap: AutomationsViewWrapper,
    titlebar: AutomationsTitlebar,
    main: AutomationsMainPanel,
  },
});
