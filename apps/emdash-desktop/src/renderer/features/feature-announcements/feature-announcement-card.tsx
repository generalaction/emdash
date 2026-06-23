import { ArrowUpRight, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { AnimatePresence, motion } from 'motion/react';
import { getFeatureAnnouncementIcon } from '@renderer/features/feature-announcements/feature-announcement-icon';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { confirmOpenExternalLink } from '@renderer/lib/open-external-link';
import { appState } from '@renderer/lib/stores/app-state';
import { Button } from '@renderer/lib/ui/button';
import { cn } from '@renderer/utils/utils';

export const FeatureAnnouncementCard = observer(function FeatureAnnouncementCard() {
  const { navigate } = useNavigate();
  const manifest = appState.featureAnnouncements.visibleManifest;

  const handleLearnMore = () => {
    if (!manifest?.learnMoreUrl) return;
    confirmOpenExternalLink(manifest.learnMoreUrl);
  };

  const handleChangelog = () => {
    if (!manifest) return;
    confirmOpenExternalLink(manifest.changelogUrl);
  };

  const handlePrimaryAction = () => {
    if (!manifest?.cta) return;

    if (manifest.cta.url) {
      confirmOpenExternalLink(manifest.cta.url);
      appState.featureAnnouncements.dismiss();
      return;
    }

    const view = appState.featureAnnouncements.resolveCtaView(manifest.cta.view);
    if (view) {
      navigate(view);
    }
    appState.featureAnnouncements.dismiss();
  };

  return (
    <AnimatePresence>
      {manifest && (
        <motion.div
          key={manifest.id}
          initial={{ opacity: 0, y: 16, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.98 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
          className="pointer-events-none fixed right-4 bottom-4 z-40 w-[min(22rem,calc(100vw-2rem))]"
          role="region"
          aria-label="Feature announcement"
        >
          <div className="pointer-events-auto overflow-hidden rounded-2xl border border-border bg-background shadow-2xl">
            <div className="relative bg-zinc-950">
              {manifest.image ? (
                <img
                  src={manifest.image}
                  alt=""
                  className="aspect-[16/10] w-full object-cover object-center"
                />
              ) : (
                <div className="flex aspect-[16/10] w-full items-center justify-center bg-gradient-to-br from-zinc-900 via-zinc-950 to-black px-6">
                  <div className="w-full max-w-[220px] rounded-xl border border-white/10 bg-white/5 p-4 shadow-lg backdrop-blur-sm">
                    <div className="mb-3 h-2 w-16 rounded-full bg-white/20" />
                    <div className="space-y-2">
                      <div className="h-2 rounded-full bg-white/15" />
                      <div className="h-2 w-4/5 rounded-full bg-white/10" />
                      <div className="h-2 w-3/5 rounded-full bg-white/10" />
                    </div>
                  </div>
                </div>
              )}
              <button
                type="button"
                onClick={() => appState.featureAnnouncements.dismiss()}
                className="absolute top-3 right-3 inline-flex size-8 items-center justify-center rounded-full bg-black/50 text-white/80 transition-colors hover:bg-black/70 hover:text-white"
                aria-label="Dismiss announcement"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="space-y-4 bg-background p-4">
              <div className="space-y-1">
                <p className="text-xs font-medium tracking-wide text-foreground-passive uppercase">
                  {manifest.eyebrow}
                </p>
                <h2 className="text-lg font-medium text-foreground">{manifest.title}</h2>
              </div>

              <ul className="space-y-3">
                {manifest.features.map((feature) => {
                  const Icon = getFeatureAnnouncementIcon(feature.icon);
                  return (
                    <li key={feature.title} className="flex gap-3">
                      <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-background-2 text-foreground-muted">
                        <Icon className="size-4" />
                      </div>
                      <div className="min-w-0 space-y-0.5">
                        <p className="text-sm font-medium text-foreground">{feature.title}</p>
                        <p className="text-xs leading-relaxed text-foreground-passive">
                          {feature.description}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>

              <div
                className={cn(
                  'flex items-center gap-3 pt-1',
                  manifest.cta ? 'justify-between' : 'justify-start'
                )}
              >
                <div className="flex min-w-0 items-center gap-3">
                  {manifest.learnMoreUrl && (
                    <button
                      type="button"
                      onClick={handleLearnMore}
                      className="inline-flex items-center gap-1 text-sm text-foreground-muted transition-colors hover:text-foreground"
                    >
                      Learn more
                      <ArrowUpRight className="size-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleChangelog}
                    className="inline-flex items-center gap-1 text-sm text-foreground-muted transition-colors hover:text-foreground"
                  >
                    Full changelog
                    <ArrowUpRight className="size-3.5" />
                  </button>
                </div>
                {manifest.cta && (
                  <Button type="button" size="sm" onClick={handlePrimaryAction}>
                    {manifest.cta.label}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
});
