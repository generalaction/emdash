import { Button, Dialog, Input, Spinner, Textarea } from '@emdash/ui/react/primitives';
import { observer } from 'mobx-react-lite';
import React, { useState } from 'react';
import { useAccountSession } from '@core/features/account/api/browser/useAccount';
import { useModalController } from '@core/manifests/browser/modal-api';
import { ConfirmButton } from '@core/primitives/keybindings/browser/confirm-button';
import { defineModal } from '@core/primitives/modals/react';
import { WaitlistBrand } from './waitlist-brand';
import { getWaitlistStore } from './waitlist-store';

// Copy mirrors emdash.com/waitlist.
export const WaitlistModal = observer(function WaitlistModal() {
  const controller = useModalController('waitlistModal');
  const store = getWaitlistStore();
  const { data: session } = useAccountSession();
  const [emailDraft, setEmail] = useState<string | null>(null);
  const email = emailDraft ?? session?.user?.email ?? '';
  const [note, setNote] = useState('');

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (await store.join(email, note)) controller.complete();
  };

  const onEdit = () => {
    if (store.errorMessage) store.clearError();
  };

  return (
    <>
      <Dialog.Header>
        <Dialog.Title className="sr-only">Join the Emdash 2.0 waitlist</Dialog.Title>
        <WaitlistBrand logoHeight={14} />
      </Dialog.Header>
      <Dialog.Body>
        <form id="waitlist-form" className="pt-0.5" onSubmit={handleSubmit}>
          <h2 className="mb-2.5 text-xl leading-[26px] font-semibold tracking-tight text-foreground">
            Any model. Any harness. Any infrastructure.
          </h2>
          <p className="mb-2 text-[13px] leading-[19px] text-foreground-muted">
            Built for teams. Run and manage coding agents from desktop, web, mobile, or Slack.
          </p>
          <p className="text-[13px] leading-[19px] text-foreground-muted">
            Preconfigure environments, share secrets, manage credentials, and set spend limits.
            Automate workflows and give agents control of the platform through MCP.
          </p>

          <label
            htmlFor="waitlist-email"
            className="mt-4 mb-1.5 block text-xs text-foreground-muted"
          >
            Work email
          </label>
          <Input
            id="waitlist-email"
            type="email"
            required
            autoFocus
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            disabled={store.submitting}
            onChange={(event) => {
              setEmail(event.target.value);
              onEdit();
            }}
          />

          <label
            htmlFor="waitlist-note"
            className="mt-4 mb-1.5 block text-xs text-foreground-muted"
          >
            Anything we should know? <span className="text-foreground-passive">(optional)</span>
          </label>
          <Textarea
            id="waitlist-note"
            rows={3}
            className="resize-none"
            placeholder="Your team, workflow, or infrastructure needs..."
            value={note}
            disabled={store.submitting}
            onChange={(event) => {
              setNote(event.target.value);
              onEdit();
            }}
          />

          {store.errorMessage ? (
            <p className="mt-3 text-xs text-foreground-destructive" role="alert">
              {store.errorMessage}
            </p>
          ) : null}
        </form>
      </Dialog.Body>
      <Dialog.Footer>
        <Button type="button" variant="secondary" onClick={() => controller.dismiss()}>
          Not now
        </Button>
        <ConfirmButton
          variant="primary"
          type="submit"
          form="waitlist-form"
          className="gap-2 px-4"
          disabled={store.submitting || email.trim().length === 0}
          aria-busy={store.submitting}
        >
          {store.submitting ? (
            <>
              <Spinner size="sm" />
              <span>Joining...</span>
            </>
          ) : (
            <span>Join waitlist</span>
          )}
        </ConfirmButton>
      </Dialog.Footer>
    </>
  );
});

export const waitlistModal = defineModal<void>()({
  id: 'waitlistModal',
  component: WaitlistModal,
});
