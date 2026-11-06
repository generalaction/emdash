import { EmdashLogo } from '@core/primitives/app-identity/browser/emdash-logo';

export function WaitlistBrand({ logoHeight }: { logoHeight: number }) {
  return (
    <div className="flex items-center gap-2 text-foreground">
      <EmdashLogo height={logoHeight} />
      <span className="inline-flex h-4 items-center rounded-[5px] border border-border-1 px-1.5 text-[10.5px] font-semibold text-foreground-muted emlight:border-border-2">
        2.0
      </span>
    </div>
  );
}
