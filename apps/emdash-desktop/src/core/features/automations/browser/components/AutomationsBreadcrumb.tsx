import { automationsViewDef } from '@core/features/automations/contributions/views';
import { useCurrentViewParams } from '@core/primitives/navigation/browser/navigation-hooks';

export function AutomationsBreadcrumb() {
  const { params } = useCurrentViewParams(automationsViewDef);

  return (
    <nav aria-label="Breadcrumb" className="flex items-center px-2">
      <span className="max-w-[14rem] truncate rounded-sm px-1 py-0.5 text-sm text-foreground">
        Automations
      </span>
      {params.tab === 'activity' && (
        <>
          <span className="px-1 text-foreground-passive">/</span>
          <span className="max-w-[14rem] truncate rounded-sm px-1 py-0.5 text-sm text-foreground">
            Activity
          </span>
        </>
      )}
    </nav>
  );
}

