import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Check, XIcon } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { getUpdateStore } from '@core/features/updates/contributions/app-stores';
import { useOpenModal } from '@core/manifests/browser/modal-api';
import { getTelemetryClient } from '@core/primitives/telemetry/browser/telemetry-client';
import { WaitlistBrand } from './waitlist-brand';
import { getWaitlistStore } from './waitlist-store';
import { getWaitlistCardMode, WAITLIST_FEATURE_FLAG } from './waitlist-visibility';

// Shares the renderer FeatureFlagProvider's query, which owns refetching until flags load.
function useWaitlistEnabled(): boolean {
  const { data: flags } = useQuery({
    queryKey: ['feature-flags'],
    queryFn: async () => (await getTelemetryClient()).getFeatureFlags(),
    staleTime: Infinity,
  });
  return flags?.[WAITLIST_FEATURE_FLAG] ?? false;
}

export const WaitlistCard = observer(function WaitlistCard() {
  const enabled = useWaitlistEnabled();
  const update = getUpdateStore();
  const store = getWaitlistStore();
  const openWaitlistModal = useOpenModal('waitlistModal');

  const mode = getWaitlistCardMode({
    enabled,
    currentVersion: update.currentVersion,
    persisted: store.persisted,
    showJoinedConfirmation: store.showJoinedConfirmation,
  });
  if (mode === 'hidden') return null;

  return (
    <div className="relative mx-3 mb-3 shrink-0 rounded-xl border border-border p-3">
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => store.dismiss(update.currentVersion)}
        className="absolute top-2 right-2 flex size-6 items-center justify-center rounded-md text-foreground-passive hover:bg-background-tertiary-2 hover:text-foreground-muted emlight:text-foreground-muted emlight:hover:text-foreground"
      >
        <XIcon className="size-3.5" />
      </button>
      <WaitlistBrand logoHeight={11} />
      {mode === 'joined' ? (
        <div role="status" className="mt-2 pr-1.5">
          <div className="flex items-center gap-1.5 text-[13px] leading-[18px] font-medium text-foreground">
            <Check className="size-3.5 text-foreground-success" strokeWidth={2.5} />
            You&rsquo;re on the waitlist
          </div>
          <p className="mt-0.5 text-xs leading-[17px] text-foreground-passive emlight:text-foreground-muted">
            We&rsquo;ll reach out at{' '}
            <span className="text-foreground-muted emlight:text-foreground">
              {store.persisted.joinedEmail}
            </span>
            .
          </p>
        </div>
      ) : (
        <>
          <p className="mt-2 pr-1.5 text-xs leading-[17px] text-foreground-passive emlight:text-foreground-muted">
            Any model. Any harness. Any infrastructure. Now in early access.
          </p>
          <button
            type="button"
            onClick={() => void openWaitlistModal()}
            className="focus-visible:ring-ring mt-2.5 flex h-[30px] w-full items-center justify-center gap-1.5 rounded-lg bg-foreground text-xs font-medium text-background transition-colors hover:bg-foreground/90 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            Join the waitlist
            <ArrowRight className="size-3.5" />
          </button>
        </>
      )}
    </div>
  );
});
