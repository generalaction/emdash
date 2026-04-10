import { useForm } from '@tanstack/react-form';
import {
  ArrowLeftIcon,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  LoaderCircle,
  XCircle,
} from 'lucide-react';
import { useState } from 'react';
import * as z from 'zod';
import type { ConnectionTestResult, SshConfig } from '@shared/ssh';
import type { BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { useSshConnectionContext } from '@renderer/lib/providers/ssh-connection-provider';
import { Button } from '@renderer/lib/ui/button';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@renderer/lib/ui/field';
import { Input } from '@renderer/lib/ui/input';
import { ModalLayout } from '@renderer/lib/ui/modal-layout';
import { RadioGroup, RadioGroupItem } from '@renderer/lib/ui/radio-group';

const formSchema = z
  .object({
    name: z.string().min(1, 'Name is required'),
    host: z
      .string()
      .min(1, 'Host is required')
      .regex(/^[a-zA-Z0-9._\-[\]:]+$/, 'Invalid hostname or IP address'),
    port: z
      .number()
      .int()
      .min(1, 'Port must be at least 1')
      .max(65535, 'Port must be at most 65535'),
    username: z.string().min(1, 'Username is required'),
    authType: z.enum(['password', 'key', 'agent']),
    password: z.string(),
    privateKeyPath: z.string(),
    passphrase: z.string(),
  })
  .superRefine((val, ctx) => {
    if (val.authType === 'password' && !val.password) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Password is required',
        path: ['password'],
      });
    }
    if (val.authType === 'key' && !val.privateKeyPath) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Private key path is required',
        path: ['privateKeyPath'],
      });
    }
  });

type AuthType = 'password' | 'key' | 'agent';
type TestState = 'idle' | 'testing' | 'success' | 'error';

export function AddSshConnModal({ onSuccess, onClose }: BaseModalProps<{ connectionId: string }>) {
  const { saveConnection, testConnection } = useSshConnectionContext();

  const [testState, setTestState] = useState<TestState>('idle');
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [showDebugLogs, setShowDebugLogs] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm({
    defaultValues: {
      name: '',
      host: '',
      port: 22,
      username: '',
      authType: 'password' as AuthType,
      password: '',
      privateKeyPath: '',
      passphrase: '',
    },
    validators: {
      onSubmit: formSchema,
    },
    onSubmit: async ({ value }) => {
      setIsSubmitting(true);
      try {
        const config: Omit<SshConfig, 'id'> & { password?: string; passphrase?: string } = {
          name: value.name,
          host: value.host,
          port: value.port,
          username: value.username,
          authType: value.authType,
          privateKeyPath: value.authType === 'key' ? value.privateKeyPath : undefined,
          useAgent: value.authType === 'agent',
          password: value.authType === 'password' ? value.password : undefined,
          passphrase: value.authType === 'key' ? value.passphrase : undefined,
        };
        const saved = await saveConnection(config);
        onSuccess({ connectionId: saved.id });
      } finally {
        setIsSubmitting(false);
      }
    },
  });

  const buildTestConfig = (): SshConfig & { password?: string; passphrase?: string } => {
    const v = form.state.values;
    return {
      id: '',
      name: v.name,
      host: v.host,
      port: v.port,
      username: v.username,
      authType: v.authType,
      privateKeyPath: v.authType === 'key' ? v.privateKeyPath : undefined,
      useAgent: v.authType === 'agent',
      password: v.authType === 'password' ? v.password : undefined,
      passphrase: v.authType === 'key' ? v.passphrase : undefined,
    };
  };

  const handleTestConnection = async () => {
    setTestState('testing');
    setTestResult(null);
    setShowDebugLogs(false);
    try {
      const result = await testConnection(buildTestConfig());
      setTestResult(result);
      setTestState(result.success ? 'success' : 'error');
    } catch (err) {
      setTestState('error');
      setTestResult({ success: false, error: String(err) });
    }
  };

  return (
    <ModalLayout
      header={
        <DialogHeader
          showCloseButton={false}
          className="flex-row items-center gap-2 -mt-2 w-full justify-between"
        >
          <div className="flex items-center gap-2 -ml-2">
            <Button variant="ghost" size="icon-sm" onClick={onClose}>
              <ArrowLeftIcon className="w-4 h-4" />
            </Button>
            <DialogTitle>Add SSH Connection</DialogTitle>
          </div>
        </DialogHeader>
      }
      footer={
        <DialogFooter className="sm:justify-between">
          <Button
            type="button"
            variant="outline"
            onClick={handleTestConnection}
            disabled={testState === 'testing'}
          >
            {testState === 'testing' ? (
              <>
                <LoaderCircle className="size-4 animate-spin" />
                Testing…
              </>
            ) : (
              'Test Connection'
            )}
          </Button>
          <div className="flex gap-2">
            <ConfirmButton type="submit" form="add-ssh-conn-form" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <LoaderCircle className="size-4 animate-spin" />
                  Saving…
                </>
              ) : (
                'Save'
              )}
            </ConfirmButton>
          </div>
        </DialogFooter>
      }
    >
      <DialogContentArea>
        <form
          id="add-ssh-conn-form"
          onSubmit={(e) => {
            e.preventDefault();
            form.handleSubmit();
          }}
        >
          <FieldGroup>
            {/* Connection name */}
            <form.Field name="name">
              {(field) => {
                const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
                return (
                  <Field data-invalid={isInvalid}>
                    <FieldLabel htmlFor={field.name}>Connection Name</FieldLabel>
                    <Input
                      id={field.name}
                      name={field.name}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                      aria-invalid={isInvalid}
                      placeholder="My Server"
                    />
                    {isInvalid && <FieldError errors={field.state.meta.errors} />}
                  </Field>
                );
              }}
            </form.Field>

            {/* Host + Port */}
            <div className="grid grid-cols-[1fr_6rem] gap-3">
              <form.Field name="host">
                {(field) => {
                  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
                  return (
                    <Field data-invalid={isInvalid}>
                      <FieldLabel htmlFor={field.name}>Host</FieldLabel>
                      <Input
                        id={field.name}
                        name={field.name}
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(e) => field.handleChange(e.target.value)}
                        aria-invalid={isInvalid}
                        placeholder="example.com"
                      />
                      {isInvalid && <FieldError errors={field.state.meta.errors} />}
                    </Field>
                  );
                }}
              </form.Field>
              <form.Field name="port">
                {(field) => {
                  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
                  return (
                    <Field data-invalid={isInvalid}>
                      <FieldLabel htmlFor={field.name}>Port</FieldLabel>
                      <Input
                        id={field.name}
                        name={field.name}
                        type="number"
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(e) => field.handleChange(Number(e.target.value))}
                        aria-invalid={isInvalid}
                      />
                      {isInvalid && <FieldError errors={field.state.meta.errors} />}
                    </Field>
                  );
                }}
              </form.Field>
            </div>

            {/* Username */}
            <form.Field name="username">
              {(field) => {
                const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
                return (
                  <Field data-invalid={isInvalid}>
                    <FieldLabel htmlFor={field.name}>Username</FieldLabel>
                    <Input
                      id={field.name}
                      name={field.name}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                      aria-invalid={isInvalid}
                      placeholder="ubuntu"
                      autoComplete="off"
                    />
                    {isInvalid && <FieldError errors={field.state.meta.errors} />}
                  </Field>
                );
              }}
            </form.Field>

            {/* Auth type */}
            <form.Field name="authType">
              {(field) => (
                <FieldSet>
                  <FieldLegend variant="label">Authentication</FieldLegend>
                  <RadioGroup
                    value={field.state.value}
                    onValueChange={(v) => field.handleChange(v as AuthType)}
                    className="grid-cols-3"
                  >
                    {(['password', 'key', 'agent'] as const).map((type) => (
                      <label
                        key={type}
                        className="flex cursor-pointer items-center gap-2 text-sm font-normal"
                      >
                        <RadioGroupItem value={type} />
                        {type === 'password' ? 'Password' : type === 'key' ? 'SSH Key' : 'Agent'}
                      </label>
                    ))}
                  </RadioGroup>
                </FieldSet>
              )}
            </form.Field>

            {/* Auth credential fields — reactive to authType */}
            <form.Subscribe selector={(state) => state.values.authType}>
              {(authType) => {
                if (authType === 'password') {
                  return (
                    <form.Field name="password">
                      {(field) => {
                        const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
                        return (
                          <Field data-invalid={isInvalid}>
                            <FieldLabel htmlFor={field.name}>Password</FieldLabel>
                            <Input
                              id={field.name}
                              name={field.name}
                              type="password"
                              value={field.state.value ?? ''}
                              onBlur={field.handleBlur}
                              onChange={(e) => field.handleChange(e.target.value)}
                              aria-invalid={isInvalid}
                              autoComplete="current-password"
                            />
                            {isInvalid && <FieldError errors={field.state.meta.errors} />}
                          </Field>
                        );
                      }}
                    </form.Field>
                  );
                }

                if (authType === 'key') {
                  return (
                    <>
                      <form.Field name="privateKeyPath">
                        {(field) => {
                          const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
                          return (
                            <Field data-invalid={isInvalid}>
                              <FieldLabel htmlFor={field.name}>Private Key Path</FieldLabel>
                              <Input
                                id={field.name}
                                name={field.name}
                                value={field.state.value ?? ''}
                                onBlur={field.handleBlur}
                                onChange={(e) => field.handleChange(e.target.value)}
                                aria-invalid={isInvalid}
                                placeholder="~/.ssh/id_rsa"
                              />
                              {isInvalid && <FieldError errors={field.state.meta.errors} />}
                            </Field>
                          );
                        }}
                      </form.Field>
                      <form.Field name="passphrase">
                        {(field) => (
                          <Field>
                            <FieldLabel htmlFor={field.name}>Passphrase</FieldLabel>
                            <Input
                              id={field.name}
                              name={field.name}
                              type="password"
                              value={field.state.value ?? ''}
                              onBlur={field.handleBlur}
                              onChange={(e) => field.handleChange(e.target.value)}
                              placeholder="Optional"
                              autoComplete="off"
                            />
                            <FieldDescription>
                              Leave empty if your key has no passphrase.
                            </FieldDescription>
                          </Field>
                        )}
                      </form.Field>
                    </>
                  );
                }

                return (
                  <FieldDescription>
                    The SSH agent running on this machine will be used for authentication. Make sure
                    your key is loaded into the agent.
                  </FieldDescription>
                );
              }}
            </form.Subscribe>
          </FieldGroup>
        </form>
        {/* Test connection result */}
        {testState !== 'idle' && (
          <div className="rounded-md border border-input px-3 py-2 text-sm">
            <div className="flex items-center gap-2">
              {testState === 'testing' && (
                <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
              )}
              {testState === 'success' && <CheckCircle2 className="size-4 text-green-500" />}
              {testState === 'error' && <XCircle className="size-4 text-destructive" />}
              <span className="flex-1 font-medium">
                {testState === 'testing' && 'Testing connection…'}
                {testState === 'success' &&
                  'Connected' + (testResult?.latency ? ' (' + testResult.latency + 'ms)' : '')}
                {testState === 'error' && (testResult?.error ?? 'Connection failed')}
              </span>
              {testState === 'error' &&
                testResult?.debugLogs &&
                testResult.debugLogs.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowDebugLogs((v) => !v)}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    {showDebugLogs ? (
                      <ChevronUp className="size-3" />
                    ) : (
                      <ChevronDown className="size-3" />
                    )}
                    Logs
                  </button>
                )}
            </div>
            {showDebugLogs && testResult?.debugLogs && (
              <pre className="mt-2 max-h-32 overflow-y-auto rounded bg-muted px-2 py-1.5 text-xs text-muted-foreground">
                {testResult.debugLogs.join('\n')}
              </pre>
            )}
          </div>
        )}
      </DialogContentArea>
    </ModalLayout>
  );
}
