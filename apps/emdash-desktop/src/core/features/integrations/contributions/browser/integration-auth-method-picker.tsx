import { Alert, Button, Dialog, SelectableCard } from '@emdash/ui/react/primitives';
import { ArrowRight, Loader2, type LucideIcon } from 'lucide-react';
import { useId } from 'react';

export type IntegrationAuthMethodOption = {
  id: string;
  icon: LucideIcon;
  title: string;
  description?: string;
  label?: string;
  loadingLabel?: string;
  loading?: boolean;
  error?: string;
  onSelect: () => void;
};

/** Shared acquisition UI; providers own method availability, state, and actions. */
export function IntegrationAuthMethodPicker({
  methods,
  onClose,
}: {
  methods: IntegrationAuthMethodOption[];
  onClose: () => void;
}) {
  const id = useId();
  const busy = methods.some((method) => method.loading);

  return (
    <>
      <Dialog.Body className="gap-3">
        {methods.map((method) => {
          const Icon = method.icon;
          const label = method.label ?? method.title;
          const errorId = `${id}-${method.id}-error`;

          return (
            <div key={method.id}>
              <SelectableCard
                padding="3"
                borderRadius="lg"
                className="group gap-3 text-left disabled:opacity-60"
                disabled={busy}
                interactive={!busy}
                aria-label={method.loading ? (method.loadingLabel ?? label) : label}
                aria-busy={method.loading || undefined}
                aria-describedby={method.error ? errorId : undefined}
                onClick={method.onSelect}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-medium text-foreground">{method.title}</h3>
                  {method.description ? (
                    <p className="mt-0.5 text-xs">{method.description}</p>
                  ) : null}
                </div>
                {method.loading ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                ) : (
                  <ArrowRight className="h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
                )}
              </SelectableCard>
              {method.error ? (
                <Alert.Root status="destructive" className="mt-2" id={errorId}>
                  <Alert.Description>{method.error}</Alert.Description>
                </Alert.Root>
              ) : null}
            </div>
          );
        })}
      </Dialog.Body>
      <Dialog.Footer>
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
      </Dialog.Footer>
    </>
  );
}
