import { useForm } from '@tanstack/react-form';
import {
  ArrowLeftIcon,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  LoaderCircle,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSshConfigHost, useSshConfigHosts } from '@renderer/lib/hooks/use-ssh-config-hosts';
import type { BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { appState } from '@renderer/lib/stores/app-state';
import { Button } from '@renderer/lib/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@renderer/lib/ui/collapsible';
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
import { Select, SelectContent, SelectItem, SelectTrigger } from '@renderer/lib/ui/select';
import { Switch } from '@renderer/lib/ui/switch';
import type { ConnectionTestResult, SshConfig, SshConfigHost } from '@shared/ssh';
import { suggestedAuthTypeForSshConfigHost, type AuthType } from './ssh-connection-form-model';
import { sshConnectionFormSchema } from './ssh-connection-form-schema';

export interface AddSshConnModalProps extends BaseModalProps<{ connectionId: string }> {
  initialConfig?: SshConfig;
  dismissControl?: 'back' | 'close';
}

type TestState = 'idle' | 'testing' | 'success' | 'error';
const MANUAL_CONNECTION_VALUE = '__manual__';
const EMPTY_SSH_CONFIG_HOSTS: SshConfigHost[] = [];

export function AddSshConnModal({
  onSuccess,
  onClose,
  initialConfig,
  dismissControl = 'back',
}: AddSshConnModalProps) {
  const sshConnections = appState.sshConnections;
  const isEditing = !!initialConfig;
  const showBackButton = dismissControl === 'back';

  const [testState, setTestState] = useState<TestState>('idle');
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [showDebugLogs, setShowDebugLogs] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(
    !!initialConfig?.proxyJump || initialConfig?.forwardAgent === true
  );
  const [selectedSshConfigAlias, setSelectedSshConfigAlias] = useState(
    initialConfig?.sshConfigAlias ?? ''
  );

  const form = useForm({
    defaultValues: {
      name: initialConfig?.name ?? '',
      host: initialConfig?.host ?? '',
      port: initialConfig?.port ?? 22,
      username: initialConfig?.username ?? '',
      authType: (initialConfig?.authType ?? 'password') as AuthType,
      password: '',
      privateKeyPath: initialConfig?.privateKeyPath ?? '',
      passphrase: '',
      sshConfigAlias: initialConfig?.sshConfigAlias ?? '',
      forwardAgent: initialConfig?.forwardAgent ?? false,
      proxyJump: initialConfig?.proxyJump ?? '',
      proxyCommand: '',
      isEditing,
    },
    validators: {
      onSubmit: sshConnectionFormSchema,
    },
    onSubmit: async ({ value }) => {
      setIsSubmitting(true);
      try {
        const isAliasBacked = value.sshConfigAlias.trim().length > 0;
        const proxyJump = value.proxyJump.trim();
        const username = value.username || value.sshConfigAlias || value.host;
        const privateKeyPath = value.privateKeyPath.trim();
        const config: Partial<Pick<SshConfig, 'id'>> &
          Omit<SshConfig, 'id'> & { password?: string; passphrase?: string } = {
          id: initialConfig?.id,
          name: value.name,
          host: value.host,
          port: value.port,
          username,
          sshConfigAlias: value.sshConfigAlias || undefined,
          authType: value.authType,
          privateKeyPath:
            value.authType === 'key' && !isAliasBacked ? privateKeyPath || undefined : undefined,
          useAgent: value.authType === 'agent',
          forwardAgent: isAliasBacked ? undefined : value.forwardAgent,
          proxyJump: isAliasBacked ? undefined : proxyJump,
          password: value.authType === 'password' ? value.password : undefined,
          passphrase: value.authType === 'key' ? value.passphrase : undefined,
        };
        const saved = await sshConnections.saveConnection(config);
        onSuccess({ connectionId: saved.id });
      } catch (err) {
        setTestState('error');
        setTestResult({ success: false, error: err instanceof Error ? err.message : String(err) });
      } finally {
        setIsSubmitting(false);
      }
    },
  });

  const buildTestConfig = (): SshConfig & { password?: string; passphrase?: string } => {
    const v = form.state.values;
    const username = v.username || v.sshConfigAlias || v.host;
    const privateKeyPath = v.privateKeyPath.trim();
    return {
      id: '',
      name: v.name,
      host: v.host,
      port: v.port,
      username,
      sshConfigAlias: v.sshConfigAlias || undefined,
      authType: v.authType,
      privateKeyPath:
        v.authType === 'key' && !v.sshConfigAlias ? privateKeyPath || undefined : undefined,
      useAgent: v.authType === 'agent',
      forwardAgent: v.sshConfigAlias ? undefined : v.forwardAgent,
      proxyJump: v.sshConfigAlias ? undefined : v.proxyJump.trim() || undefined,
      password: v.authType === 'password' ? v.password : undefined,
      passphrase: v.authType === 'key' ? v.passphrase : undefined,
    };
  };

  const sshConfigHostsQuery = useSshConfigHosts();
  const resolvedSshConfigHostQuery = useSshConfigHost(selectedSshConfigAlias);
  const sshConfigHosts = sshConfigHostsQuery.data ?? EMPTY_SSH_CONFIG_HOSTS;
  const sshConfigLoadError = sshConfigHostsQuery.error
    ? sshConfigHostsQuery.error instanceof Error
      ? sshConfigHostsQuery.error.message
      : String(sshConfigHostsQuery.error)
    : null;

  const sshConfigHostsByAlias = useMemo(
    () => new Map(sshConfigHosts.map((host) => [host.host, host])),
    [sshConfigHosts]
  );
  const selectedSshConfigHost =
    resolvedSshConfigHostQuery.data ?? sshConfigHostsByAlias.get(selectedSshConfigAlias);

  const applySshConfigHostFields = useCallback(
    (host: SshConfigHost) => {
      form.setFieldValue('host', host.hostname || host.host);
      form.setFieldValue('port', host.port ?? 22);
      form.setFieldValue('username', host.user ?? form.state.values.username);
      form.setFieldValue('authType', suggestedAuthTypeForSshConfigHost(host));
      form.setFieldValue('privateKeyPath', host.identityFile ?? form.state.values.privateKeyPath);
      form.setFieldValue('forwardAgent', host.forwardAgent ?? false);
      form.setFieldValue('proxyJump', host.proxyJump ?? '');
      form.setFieldValue('proxyCommand', host.proxyCommand ?? '');
    },
    [form]
  );

  useEffect(() => {
    if (!selectedSshConfigAlias || !selectedSshConfigHost) return;
    if (form.state.values.sshConfigAlias !== selectedSshConfigAlias) return;
    applySshConfigHostFields(selectedSshConfigHost);
  }, [applySshConfigHostFields, form, selectedSshConfigAlias, selectedSshConfigHost]);

  const shouldShowSshConfigField =
    sshConfigHosts.length > 0 || !!selectedSshConfigAlias || !!sshConfigLoadError;

  const applySshConfigHost = (host: SshConfigHost) => {
    setSelectedSshConfigAlias(host.host);
    form.setFieldValue('sshConfigAlias', host.host);
    form.setFieldValue('name', form.state.values.name || host.host);
    applySshConfigHostFields(host);
    setIsAdvancedOpen(true);
  };

  const handleTestConnection = async () => {
    setTestState('testing');
    setTestResult(null);
    setShowDebugLogs(false);
    try {
      const result = await sshConnections.testConnection(buildTestConfig());
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
          showCloseButton={!showBackButton}
          className="-mt-2 w-full flex-row items-center justify-between gap-2"
        >
          <div className={`flex items-center gap-2 ${showBackButton ? '-ml-2' : ''}`}>
            {showBackButton && (
              <Button variant="ghost" size="icon-xs" onClick={onClose}>
                <ArrowLeftIcon className="h-4 w-4" />
              </Button>
            )}
            <DialogTitle>{isEditing ? 'Edit SSH Connection' : 'Add SSH Connection'}</DialogTitle>
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
            {!showBackButton && (
              <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
                Cancel
              </Button>
            )}
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
            void form.handleSubmit();
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

            {shouldShowSshConfigField && (
              <form.Field name="sshConfigAlias">
                {(field) => {
                  const selectedHost = sshConfigHostsByAlias.get(field.state.value);
                  return (
                    <Field>
                      <FieldLabel>SSH Config</FieldLabel>
                      {sshConfigHosts.length > 0 && (
                        <Select
                          value={field.state.value || MANUAL_CONNECTION_VALUE}
                          onValueChange={(value) => {
                            if (!value) return;
                            if (value === MANUAL_CONNECTION_VALUE) {
                              setSelectedSshConfigAlias('');
                              field.handleChange('');
                              form.setFieldValue('name', '');
                              form.setFieldValue('host', '');
                              form.setFieldValue('port', 22);
                              form.setFieldValue('username', '');
                              form.setFieldValue('authType', 'password');
                              form.setFieldValue('privateKeyPath', '');
                              form.setFieldValue('passphrase', '');
                              form.setFieldValue('forwardAgent', false);
                              form.setFieldValue('proxyJump', '');
                              form.setFieldValue('proxyCommand', '');
                              setIsAdvancedOpen(false);
                              return;
                            }
                            const host = sshConfigHostsByAlias.get(value);
                            if (host) applySshConfigHost(host);
                          }}
                        >
                          <SelectTrigger className="w-full">
                            <span className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
                              {selectedHost ? (
                                <span className="truncate">{selectedHost.host}</span>
                              ) : field.state.value ? (
                                <span className="truncate">{field.state.value}</span>
                              ) : (
                                'Manual connection'
                              )}
                            </span>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={MANUAL_CONNECTION_VALUE}>
                              Manual connection
                            </SelectItem>
                            {sshConfigHosts.map((host) => (
                              <SelectItem key={host.host} value={host.host}>
                                <span className="truncate">{host.host}</span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                      {sshConfigLoadError && (
                        <FieldDescription>{sshConfigLoadError}</FieldDescription>
                      )}
                    </Field>
                  );
                }}
              </form.Field>
            )}

            {/* Host + Port */}
            <div className="grid grid-cols-[1fr_6rem] gap-3">
              <form.Field name="host">
                {(field) => {
                  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
                  const isAliasBacked = !!form.state.values.sshConfigAlias;
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
                        disabled={isAliasBacked}
                      />
                      {isInvalid && <FieldError errors={field.state.meta.errors} />}
                    </Field>
                  );
                }}
              </form.Field>
              <form.Field name="port">
                {(field) => {
                  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
                  const isAliasBacked = !!form.state.values.sshConfigAlias;
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
                        disabled={isAliasBacked}
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
                const isAliasBacked = !!form.state.values.sshConfigAlias;
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
                      disabled={isAliasBacked}
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
            <form.Subscribe
              selector={(state) => ({
                authType: state.values.authType,
                sshConfigAlias: state.values.sshConfigAlias,
              })}
            >
              {({ authType, sshConfigAlias }) => {
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
                              placeholder={isEditing ? 'Leave blank to keep existing' : undefined}
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
                                disabled={!!sshConfigAlias}
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
                              placeholder={isEditing ? 'Leave blank to keep existing' : 'Optional'}
                              autoComplete="off"
                            />
                            {!isEditing && (
                              <FieldDescription>
                                Leave empty if your key has no passphrase.
                              </FieldDescription>
                            )}
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

            <form.Subscribe
              selector={(state) => ({
                sshConfigAlias: state.values.sshConfigAlias,
                proxyCommand: state.values.proxyCommand,
              })}
            >
              {({ sshConfigAlias, proxyCommand }) => {
                const isAliasBacked = !!sshConfigAlias;
                const showProxyCommand = isAliasBacked && proxyCommand.trim().length > 0;
                return (
                  <Collapsible
                    open={isAliasBacked || isAdvancedOpen}
                    onOpenChange={isAliasBacked ? undefined : setIsAdvancedOpen}
                  >
                    <CollapsibleTrigger
                      type="button"
                      className="flex h-8 w-full items-center justify-between rounded-md px-0 text-sm font-medium text-foreground-muted hover:text-foreground"
                      disabled={isAliasBacked}
                    >
                      <span>Advanced</span>
                      {isAliasBacked || isAdvancedOpen ? (
                        <ChevronUp className="size-4" />
                      ) : (
                        <ChevronDown className="size-4" />
                      )}
                    </CollapsibleTrigger>
                    <CollapsibleContent className="grid gap-3 pt-2">
                      {showProxyCommand ? (
                        <form.Field name="proxyCommand">
                          {(field) => (
                            <Field>
                              <FieldLabel htmlFor={field.name}>ProxyCommand</FieldLabel>
                              <Input
                                id={field.name}
                                name={field.name}
                                value={field.state.value}
                                disabled
                              />
                            </Field>
                          )}
                        </form.Field>
                      ) : (
                        <form.Field name="proxyJump">
                          {(field) => (
                            <Field>
                              <FieldLabel htmlFor={field.name}>ProxyJump</FieldLabel>
                              <Input
                                id={field.name}
                                name={field.name}
                                value={field.state.value}
                                onBlur={field.handleBlur}
                                onChange={(e) => field.handleChange(e.target.value)}
                                placeholder="bastion or user@bastion:2222"
                                autoComplete="off"
                                disabled={isAliasBacked}
                              />
                            </Field>
                          )}
                        </form.Field>
                      )}
                      <form.Field name="forwardAgent">
                        {(field) => (
                          <Field className="flex-row items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
                            <FieldLabel htmlFor={field.name}>ForwardAgent</FieldLabel>
                            <Switch
                              id={field.name}
                              checked={field.state.value}
                              onCheckedChange={(checked) => field.handleChange(checked)}
                              disabled={isAliasBacked}
                            />
                          </Field>
                        )}
                      </form.Field>
                    </CollapsibleContent>
                  </Collapsible>
                );
              }}
            </form.Subscribe>
          </FieldGroup>
        </form>
        {/* Test connection result */}
        {testState !== 'idle' && (
          <div className="border-input rounded-md border px-3 py-2 text-sm">
            <div className="flex items-center gap-2">
              {testState === 'testing' && (
                <LoaderCircle className="text-muted-foreground size-4 animate-spin" />
              )}
              {testState === 'success' && (
                <CheckCircle2 className="size-4 text-foreground-success" />
              )}
              {testState === 'error' && <XCircle className="text-destructive size-4" />}
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
                    className="text-muted-foreground flex items-center gap-1 text-xs hover:text-foreground"
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
              <pre className="bg-muted text-muted-foreground mt-2 max-h-32 overflow-y-auto rounded px-2 py-1.5 text-xs">
                {testResult.debugLogs.join('\n')}
              </pre>
            )}
          </div>
        )}
      </DialogContentArea>
    </ModalLayout>
  );
}
