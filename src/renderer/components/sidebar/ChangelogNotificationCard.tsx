import { Badge } from '@/components/ui/badge';
import { formatChangelogPublishedAt } from '@/lib/changelogDate';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import type { ChangelogEntry } from '@shared/changelog';
import { getEmdashV1BetaUrl } from '@shared/urls';
import { ArrowRight, ExternalLink, X } from 'lucide-react';
import { useEmdashAccount } from '@/contexts/EmdashAccountProvider';
import { Button } from '@/components/ui/button';

interface ChangelogNotificationCardProps {
  entry: ChangelogEntry;
  onOpen: () => void;
  onCreateAccount: () => void;
  onDismiss: () => void;
  className?: string;
}

export function ChangelogNotificationCard({
  entry,
  onOpen,
  onCreateAccount,
  onDismiss,
  className,
}: ChangelogNotificationCardProps) {
  const publishedAt = formatChangelogPublishedAt(entry.publishedAt);
  const { hasAccount } = useEmdashAccount();
  const betaUrl = getEmdashV1BetaUrl('changelog-notification-card');

  return (
    <motion.div
      whileTap={{ scale: 0.97 }}
      className={cn(
        'relative rounded-xl border border-border/80 bg-background/80 shadow-sm backdrop-blur',
        className
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full flex-col gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-accent/30"
      >
        <div className="pr-8">
          {publishedAt && (
            <Badge variant="outline" className="mb-2 h-5 px-2 text-[11px] font-medium">
              {publishedAt}
            </Badge>
          )}
          <h3 className="line-clamp-2 text-sm font-semibold leading-5 text-foreground">
            {entry.title}
          </h3>
        </div>

        <div className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
          <span>Full changelog</span>
          <ArrowRight className="h-3.5 w-3.5" />
        </div>
      </button>

      {!hasAccount && (
        <div className="border-t border-border/60 px-3 pb-3 pt-2">
          <p className="text-xs text-muted-foreground">Emdash now offers accounts.</p>
          <Button
            variant="ghost"
            size="sm"
            onClick={(event) => {
              event.stopPropagation();
              onCreateAccount();
            }}
            className="mt-1.5 h-auto px-0 py-0 text-xs font-medium text-primary hover:bg-transparent hover:underline"
          >
            Create account
            <ArrowRight className="ml-1 h-3 w-3" />
          </Button>
        </div>
      )}

      <div className="border-t border-border/60 p-3">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            window.electronAPI.openExternal(betaUrl);
          }}
          className="flex w-full items-center justify-between gap-3 rounded-lg border border-border/70 bg-muted/35 px-3 py-2 text-left transition-colors hover:bg-accent/40"
        >
          <div className="min-w-0">
            <p className="text-xs font-semibold text-foreground">Test the v1 Beta</p>
            <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
              <span>emdash.sh</span>
              <ExternalLink className="h-3 w-3" />
            </p>
          </div>
          <ArrowRight className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
        </button>
      </div>

      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onDismiss();
        }}
        className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        aria-label={`Dismiss changelog notification for version ${entry.version}`}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </motion.div>
  );
}
