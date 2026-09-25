import { useAppForm } from '@emdash/ui/react/form';
import { useStore } from '@tanstack/react-form';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getMachinesStore } from '@core/features/machines/contributions/app-stores';
import type { ConnectionTestResult, SshConfig } from '@core/primitives/ssh/api';
import { sshCredentialReuse } from '@core/primitives/ssh/api/credential-reuse';
import {
  authenticationDraft,
  DUPLICATE_CONNECTION_NAME_ERROR,
  formatMachineError,
  machineConnectionConfig,
  machineDraftValues,
  machineEditorDefaults,
  suggestedAuthTypeForSshConfigHost,
  validateMachineDraft,
  type MachineConnectionSource,
  type MachineFormMode,
} from './machine-form-model';
import { useSshConfigDraft } from './use-ssh-config-hosts';

export type MachineTestState =
  | { status: 'idle' }
  | { status: 'testing' }
  | { status: 'finished'; result: ConnectionTestResult };
type SaveState = { status: 'idle' } | { status: 'saving' } | { status: 'failed'; error: string };
const MANUAL_SOURCE: MachineConnectionSource = { mode: 'manual' };

export function useMachineForm({
  initialConfig,
  onSaved,
}: {
  initialConfig?: SshConfig;
  onSaved: (connectionId: string) => void;
}) {
  const machines = getMachinesStore();
  const [mode, setMode] = useState<MachineFormMode>(
    initialConfig && !initialConfig.sshConfigAlias ? 'manual' : 'config'
  );
  const config = useSshConfigDraft(initialConfig?.sshConfigAlias);
  const { resolution } = config;
  const resolvedHost =
    resolution.status === 'resolved'
      ? resolution.host
      : resolution.status === 'resolving'
        ? resolution.preview
        : undefined;
  const resolvedAlias = resolution.status === 'resolved' ? resolution.alias : '';
  const configSource = useMemo<MachineConnectionSource | null>(
    () =>
      resolvedAlias && resolvedHost
        ? { mode: 'config', alias: resolvedAlias, resolved: resolvedHost }
        : null,
    [resolvedAlias, resolvedHost]
  );
  const source = mode === 'manual' ? MANUAL_SOURCE : configSource;
  const [defaults] = useState(() => machineEditorDefaults(initialConfig));
  const form = useAppForm({
    defaultValues: defaults,
    validators: {
      onSubmit: ({ value }) =>
        source ? validateMachineDraft(value, source, initialConfig) : undefined,
    },
  });
  const values = useStore(form.store, (state) => state.values);
  const [test, setTest] = useState<MachineTestState>({ status: 'idle' });
  const [save, setSave] = useState<SaveState>({ status: 'idle' });
  const generation = useRef(0);
  const operation = useRef<'test' | 'save' | null>(null);
  const mounted = useRef(true);
  const seededAlias = useRef(initialConfig?.sshConfigAlias ?? '');
  const isSaving = save.status === 'saving';
  const invalidate = useCallback(() => {
    generation.current++;
    if (operation.current === 'test') operation.current = null;
    setTest({ status: 'idle' });
    setSave((current) => (current.status === 'saving' ? current : { status: 'idle' }));
  }, []);

  useEffect(() => {
    if (!resolvedAlias || !resolvedHost || seededAlias.current === resolvedAlias) return;
    form.setFieldValue('config', {
      ...authenticationDraft(),
      authType: suggestedAuthTypeForSshConfigHost(resolvedHost),
    });
    seededAlias.current = resolvedAlias;
  }, [form, resolvedAlias, resolvedHost]);

  useEffect(() => {
    invalidate();
    let previous = form.state.values;
    const subscription = form.store.subscribe(() => {
      const next = form.state.values;
      if (next.name !== previous.name || next[mode] !== previous[mode]) invalidate();
      previous = next;
    });
    return () => subscription.unsubscribe();
  }, [form, mode, source, invalidate]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const fallbackName = mode === 'manual' ? values.manual.host : config.target;
  const name = values.name || fallbackName;
  const nameError = machines.connections.some(
    (connection) => connection.name === name && connection.id !== initialConfig?.id
  )
    ? DUPLICATE_CONNECTION_NAME_ERROR
    : null;
  const candidate = source ? machineDraftValues(values, source) : null;
  const reuse = candidate
    ? sshCredentialReuse(candidate, initialConfig)
    : { password: false, passphrase: false };

  const selectMode = (next: MachineFormMode) => {
    if (isSaving || next === mode) return;
    invalidate();
    setMode(next);
  };
  const changeTarget = (target: string) => {
    if (isSaving || target === config.target) return;
    invalidate();
    config.changeTarget(target);
    seededAlias.current = '';
    form.setFieldValue('config', authenticationDraft());
  };
  const resolve = () => {
    if (!isSaving) {
      invalidate();
      config.resolve();
    }
  };

  // Both operations validate and consume exactly the same draft snapshot.
  const run = async (kind: 'test' | 'save') => {
    if (
      !source ||
      operation.current === 'save' ||
      (kind === 'test' && operation.current === 'test') ||
      nameError
    )
      return;
    generation.current++;
    if (kind === 'test' || operation.current === 'test') setTest({ status: 'idle' });
    setSave({ status: 'idle' });
    operation.current = kind;
    const currentGeneration = generation.current;
    const snapshot = machineConnectionConfig(machineDraftValues(form.state.values, source));
    try {
      await form.validateAllFields('submit');
      await form.validate('submit');
      if (!mounted.current || currentGeneration !== generation.current || !form.state.isValid)
        return;
      if (kind === 'test') {
        setTest({ status: 'testing' });
        const result = await machines.testConnection({ ...snapshot, id: initialConfig?.id ?? '' });
        if (mounted.current && currentGeneration === generation.current)
          setTest({ status: 'finished', result });
      } else {
        setSave({ status: 'saving' });
        const saved = await machines.saveConnection({ ...snapshot, id: initialConfig?.id });
        if (!mounted.current) return;
        onSaved(saved.id);
        setSave({ status: 'idle' });
      }
    } catch (error) {
      if (!mounted.current) return;
      if (kind === 'save') setSave({ status: 'failed', error: formatMachineError(error) });
      else if (currentGeneration === generation.current)
        setTest({
          status: 'finished',
          result: { success: false, error: formatMachineError(error) },
        });
    } finally {
      if (currentGeneration === generation.current || kind === 'save') operation.current = null;
    }
  };

  return {
    form,
    mode,
    selectMode,
    isEditing: !!initialConfig,
    isSaving,
    name: { fallback: fallbackName, error: nameError },
    config: { ...config, changeTarget, resolve },
    authentication: {
      reuse,
      inheritedKey: mode === 'config' ? resolvedHost?.identityFile : undefined,
    },
    details: mode === 'config' ? resolvedHost : undefined,
    actions: {
      ready: !!source,
      isSaving,
      isTesting: test.status === 'testing',
      disabled: isSaving || (!!source && !!nameError),
      submit: () => (source ? void run('save') : resolve()),
      test: () => void run('test'),
    },
    feedback: { test, saveError: save.status === 'failed' ? save.error : null },
  };
}

export type MachineFormController = ReturnType<typeof useMachineForm>;
export type MachineEditorForm = MachineFormController['form'];
