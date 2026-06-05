import { useForm } from '@tanstack/react-form';
import type { EmdashServerConnection } from '@main/core/settings/schema';
import type { BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@renderer/lib/ui/field';
import { Input } from '@renderer/lib/ui/input';
import { ModalLayout } from '@renderer/lib/ui/modal-layout';

export interface EmdashServerModalProps extends BaseModalProps<EmdashServerConnection> {
  initialServer?: EmdashServerConnection;
}

function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

export function EmdashServerModal({ initialServer, onSuccess, onClose }: EmdashServerModalProps) {
  const isEditing = !!initialServer;

  const form = useForm({
    defaultValues: {
      label: initialServer?.label ?? '',
      url: initialServer?.url ?? 'http://home-server.local:8080',
      apiKey: initialServer?.apiKey ?? '',
    },
    onSubmit: ({ value }) => {
      onSuccess({
        id: initialServer?.id ?? crypto.randomUUID(),
        label: value.label.trim(),
        url: value.url.trim().replace(/\/$/, ''),
        apiKey: value.apiKey.trim(),
      });
    },
  });

  return (
    <ModalLayout
      header={
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit server' : 'Add rundash-server'}</DialogTitle>
        </DialogHeader>
      }
      footer={
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <form.Subscribe selector={(s) => s.isSubmitting}>
            {(isSubmitting) => (
              <Button
                type="button"
                disabled={isSubmitting}
                onClick={() => void form.handleSubmit()}
              >
                {isEditing ? 'Save' : 'Add server'}
              </Button>
            )}
          </form.Subscribe>
        </DialogFooter>
      }
    >
      <DialogContentArea>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
        >
          <form.Field
            name="label"
            validators={{ onChange: ({ value }) => (!value.trim() ? 'Label is required' : undefined) }}
          >
            {(field) => (
              <Field>
                <FieldGroup>
                  <FieldLabel htmlFor={field.name}>Label</FieldLabel>
                  <Input
                    id={field.name}
                    value={field.state.value}
                    placeholder="Home server"
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                  />
                </FieldGroup>
                <FieldDescription>A friendly name for this server.</FieldDescription>
                {field.state.meta.errors.length > 0 && (
                  <FieldError>{field.state.meta.errors[0]}</FieldError>
                )}
              </Field>
            )}
          </form.Field>

          <form.Field
            name="url"
            validators={{
              onChange: ({ value }) => {
                if (!value.trim()) return 'URL is required';
                if (!isValidUrl(value.trim())) return 'Must be a valid URL (e.g. http://home-server.local:8080)';
                return undefined;
              },
            }}
          >
            {(field) => (
              <Field>
                <FieldGroup>
                  <FieldLabel htmlFor={field.name}>Server URL</FieldLabel>
                  <Input
                    id={field.name}
                    value={field.state.value}
                    placeholder="http://home-server.local:8080"
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                  />
                </FieldGroup>
                <FieldDescription>Base URL of your rundash-server instance.</FieldDescription>
                {field.state.meta.errors.length > 0 && (
                  <FieldError>{field.state.meta.errors[0]}</FieldError>
                )}
              </Field>
            )}
          </form.Field>

          <form.Field
            name="apiKey"
            validators={{ onChange: ({ value }) => (!value.trim() ? 'API key is required' : undefined) }}
          >
            {(field) => (
              <Field>
                <FieldGroup>
                  <FieldLabel htmlFor={field.name}>API key</FieldLabel>
                  <Input
                    id={field.name}
                    value={field.state.value}
                    placeholder="esk_…"
                    type="password"
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                  />
                </FieldGroup>
                <FieldDescription>
                  The API key printed when you ran <code>rundash-server init</code>.
                </FieldDescription>
                {field.state.meta.errors.length > 0 && (
                  <FieldError>{field.state.meta.errors[0]}</FieldError>
                )}
              </Field>
            )}
          </form.Field>
        </form>
      </DialogContentArea>
    </ModalLayout>
  );
}
