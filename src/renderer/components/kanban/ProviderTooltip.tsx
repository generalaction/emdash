import React from 'react';
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from '../ui/tooltip';
import { providerAssets } from '../../providers/assets';
import { providerMeta, type UiProvider } from '../../providers/meta';

type ProviderTooltipProps = {
  providers: UiProvider[];
  adminProvider?: UiProvider | null;
  side?: 'top' | 'bottom' | 'left' | 'right';
  delay?: number;
  children: React.ReactNode;
};

export const ProviderTooltip: React.FC<ProviderTooltipProps> = ({
  providers,
  adminProvider = null,
  side = 'top',
  delay = 150,
  children,
}) => {
  const items = React.useMemo(() => {
    const seen = new Set<string>();
    const ids = (Array.isArray(providers) ? providers : []).filter(Boolean);
    return ids
      .map((id) => {
        const meta = providerMeta[id as UiProvider];
        const asset = providerAssets[id as UiProvider];
        const label = meta?.label || asset?.name || String(id);
        return {
          id: id as UiProvider,
          label,
          logo: asset?.logo,
          invert: !!asset?.invertInDark,
        };
      })
      .filter((x) => {
        if (!x.label) return false;
        if (seen.has(x.label)) return false;
        seen.add(x.label);
        return true;
      });
  }, [providers]);

  const adminLabel = React.useMemo(() => {
    if (!adminProvider) return null;
    const meta = providerMeta[adminProvider as UiProvider];
    const asset = providerAssets[adminProvider as UiProvider];
    return meta?.label || asset?.name || String(adminProvider);
  }, [adminProvider]);

  if (!items || items.length === 0) return <>{children}</>;

  return (
    <TooltipProvider delayDuration={delay}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side={side} className="max-w-xs rounded-md border border-border bg-background p-2 text-xs shadow-sm">
          <div className="mb-1 font-medium text-foreground">Providers</div>
          <div className="flex flex-col gap-1">
            {items.map((it) => (
              <div key={it.id} className="flex items-center gap-2 text-foreground/90">
                {it.logo ? (
                  <img
                    src={it.logo}
                    alt={it.label}
                    className={`h-3.5 w-3.5 shrink-0 rounded-sm ${it.invert ? 'dark:invert' : ''}`}
                  />
                ) : (
                  <span className="h-3.5 w-3.5 shrink-0 rounded-sm bg-muted" />
                )}
                <span className="leading-none">{it.label}</span>
              </div>
            ))}
          </div>
          {adminLabel ? (
            <div className="mt-2 border-t border-border/60 pt-1 text-muted-foreground">
              Admin: {adminLabel}
            </div>
          ) : null}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export default ProviderTooltip;

