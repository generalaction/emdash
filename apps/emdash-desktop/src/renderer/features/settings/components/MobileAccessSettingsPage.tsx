import {
  Check,
  Copy,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Smartphone,
  Trash2,
  Wifi,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { toast } from '@renderer/lib/hooks/use-toast';
import { events, rpc } from '@renderer/lib/ipc';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Alert, AlertDescription, AlertTitle } from '@renderer/lib/ui/alert';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';
import { Input } from '@renderer/lib/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import { Switch } from '@renderer/lib/ui/switch';
import { cn } from '@renderer/utils/utils';
import type {
  MobileAccessBindableInterface,
  MobileAccessClient,
  MobileAccessPairingCode,
  MobileAccessStatus,
} from '@shared/core/mobile-access';
import {
  mobileAccessClientsChangedChannel,
  mobileAccessStatusChangedChannel,
} from '@shared/events/mobileAccessEvents';
import {
  MOBILE_ACCESS_PORT_MAX,
  MOBILE_ACCESS_PORT_MIN,
  mobileAccessStatusLabel,
  parseMobileAccessPort,
  preferredMobileAccessAddress,
} from '../mobile-access-settings-model';
import { SettingRow } from './SettingRow';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function interfaceKindLabel(kind: MobileAccessBindableInterface['kind']): string {
  if (kind === 'vpn') return 'Private VPN';
  if (kind === 'loopback') return 'This device only';
  return 'Private network';
}

function MobileAccessStatusBadge({ status }: { status: MobileAccessStatus | null }) {
  if (!status) {
    return (
      <Badge variant="secondary" className="gap-1.5 text-foreground-muted">
        <Loader2 className="animate-spin" />
        Loading
      </Badge>
    );
  }

  const active = status.state === 'running';
  const pending = status.state === 'starting' || status.state === 'stopping';
  return (
    <Badge
      variant={status.state === 'error' ? 'destructive' : 'secondary'}
      className={cn('gap-1.5', active && 'text-foreground-success')}
    >
      <span
        className={cn(
          'size-1.5 rounded-full bg-foreground-muted',
          active && 'bg-foreground-success',
          status.state === 'error' && 'bg-destructive'
        )}
      />
      {pending ? <Loader2 className="animate-spin" /> : null}
      {mobileAccessStatusLabel(status.state)}
    </Badge>
  );
}

function CopyValueButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      const result = await rpc.app.clipboardWriteText(value);
      if (!result.success) throw new Error(result.error);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      toast({ title: 'Copy failed', description: errorMessage(error), variant: 'destructive' });
    }
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={copied ? `${label} copied` : `Copy ${label}`}
      onClick={() => void copy()}
    >
      {copied ? <Check className="text-foreground-success" /> : <Copy />}
    </Button>
  );
}

function PairedDeviceRow({
  client,
  revoking,
  onRevoke,
}: {
  client: MobileAccessClient;
  revoking: boolean;
  onRevoke: (client: MobileAccessClient) => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 py-3 first:pt-0 last:pb-0">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-background-2 text-foreground-muted">
        <Smartphone className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="truncate text-sm text-foreground">{client.name}</span>
          {client.connectionCount > 0 ? (
            <Badge variant="secondary" className="text-foreground-success">
              Connected
            </Badge>
          ) : null}
        </div>
        <div className="mt-0.5 text-xs text-foreground-passive">
          Paired {new Date(client.pairedAt).toLocaleString()}
          {client.connectionCount > 1 ? ` · ${client.connectionCount} connections` : ''}
        </div>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={revoking}
        className="hover:bg-destructive/10 text-foreground-destructive hover:text-foreground-destructive"
        onClick={() => onRevoke(client)}
      >
        {revoking ? <Loader2 className="animate-spin" /> : <Trash2 />}
        Revoke
      </Button>
    </div>
  );
}

export function MobileAccessSettingsPage() {
  const {
    value: settings,
    updateAsync,
    isLoading: isLoadingSettings,
    isSaving,
  } = useAppSettingsKey('mobileAccess');
  const showConfirm = useShowModal('confirmActionModal');
  const [status, setStatus] = useState<MobileAccessStatus | null>(null);
  const [interfaces, setInterfaces] = useState<MobileAccessBindableInterface[]>([]);
  const [clients, setClients] = useState<MobileAccessClient[]>([]);
  const [pairingCode, setPairingCode] = useState<MobileAccessPairingCode | null>(null);
  const [draftAddress, setDraftAddress] = useState<string | null>(null);
  const [draftPort, setDraftPort] = useState('7458');
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [remainingPairingSeconds, setRemainingPairingSeconds] = useState(0);
  const previousClientCount = useRef(0);
  const storedBindAddress = settings?.bindAddress;
  const storedPort = settings?.port;
  const runtimeState = status?.state;

  const refreshRuntime = useCallback(async (showFailure = true) => {
    try {
      const [nextStatus, nextInterfaces, nextClients] = await Promise.all([
        rpc.mobileAccess.getStatus(),
        rpc.mobileAccess.listBindableInterfaces(),
        rpc.mobileAccess.listClients(),
      ]);
      setStatus(nextStatus);
      setInterfaces(nextInterfaces);
      previousClientCount.current = nextClients.length;
      setClients(nextClients);
    } catch (error) {
      if (showFailure) {
        toast({
          title: 'Could not load Mobile Access',
          description: errorMessage(error),
          variant: 'destructive',
        });
      }
    }
  }, []);

  useEffect(() => {
    const offStatus = events.on(mobileAccessStatusChangedChannel, setStatus);
    const offClients = events.on(mobileAccessClientsChangedChannel, (nextClients) => {
      if (nextClients.length > previousClientCount.current) {
        setPairingCode(null);
      }
      previousClientCount.current = nextClients.length;
      setClients(nextClients);
    });
    void refreshRuntime(false);
    return () => {
      offStatus();
      offClients();
    };
  }, [refreshRuntime]);

  useEffect(() => {
    if (storedPort === undefined) return;
    setDraftAddress(storedBindAddress ?? null);
    setDraftPort(String(storedPort));
  }, [storedBindAddress, storedPort]);

  useEffect(() => {
    if (draftAddress !== null || interfaces.length === 0) return;
    setDraftAddress(preferredMobileAccessAddress(interfaces, storedBindAddress ?? null));
  }, [draftAddress, interfaces, storedBindAddress]);

  useEffect(() => {
    if (runtimeState && runtimeState !== 'running') setPairingCode(null);
  }, [runtimeState]);

  useEffect(() => {
    if (!pairingCode) {
      setRemainingPairingSeconds(0);
      return;
    }
    const updateRemaining = () => {
      const seconds = Math.max(0, Math.ceil((pairingCode.expiresAt - Date.now()) / 1000));
      setRemainingPairingSeconds(seconds);
      if (seconds === 0) setPairingCode(null);
    };
    updateRemaining();
    const timer = setInterval(updateRemaining, 1000);
    return () => clearInterval(timer);
  }, [pairingCode]);

  const selectedInterface = useMemo(
    () => interfaces.find((candidate) => candidate.address === draftAddress) ?? null,
    [draftAddress, interfaces]
  );
  const parsedPort = parseMobileAccessPort(draftPort);
  const validAddress = selectedInterface !== null;
  const endpointChanged =
    !!settings && (draftAddress !== settings.bindAddress || parsedPort !== settings.port);
  const configBusy = isLoadingSettings || isSaving || busyAction !== null;

  const handleToggle = async (enabled: boolean) => {
    if (!settings) return;
    if (!enabled) {
      setBusyAction('toggle');
      try {
        await updateAsync({ enabled: false });
        setPairingCode(null);
        await refreshRuntime(false);
      } catch (error) {
        toast({
          title: 'Could not stop Mobile Access',
          description: errorMessage(error),
          variant: 'destructive',
        });
      } finally {
        setBusyAction(null);
      }
      return;
    }

    if (!draftAddress || !validAddress || parsedPort === null) {
      toast({
        title: 'Choose a valid private network address and port',
        description: `The port must be between ${MOBILE_ACCESS_PORT_MIN} and ${MOBILE_ACCESS_PORT_MAX}.`,
        variant: 'destructive',
      });
      return;
    }
    setBusyAction('toggle');
    try {
      await updateAsync({ enabled: true, bindAddress: draftAddress, port: parsedPort });
      await refreshRuntime(false);
    } catch (error) {
      toast({
        title: 'Could not start Mobile Access',
        description: errorMessage(error),
        variant: 'destructive',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const applyEndpoint = async () => {
    if (!draftAddress || !validAddress || parsedPort === null) return;
    setBusyAction('apply');
    try {
      await updateAsync({ bindAddress: draftAddress, port: parsedPort });
      setPairingCode(null);
      await refreshRuntime(false);
      toast({ title: settings?.enabled ? 'Mobile Access restarted' : 'Mobile Access updated' });
    } catch (error) {
      toast({
        title: 'Could not apply Mobile Access settings',
        description: errorMessage(error),
        variant: 'destructive',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const requestApplyEndpoint = () => {
    if (settings?.enabled && clients.length > 0) {
      showConfirm({
        title: 'Restart Mobile Access?',
        description:
          'Changing the network address or port disconnects every paired device. Each device will need a new pairing code.',
        confirmLabel: 'Apply & Restart',
        variant: 'destructive',
        onSuccess: () => void applyEndpoint(),
      });
      return;
    }
    void applyEndpoint();
  };

  const restartGateway = async () => {
    setBusyAction('restart');
    try {
      const result = await rpc.mobileAccess.restart();
      if (!result.success) throw new Error(result.error.message);
      setStatus(result.value);
      setPairingCode(null);
      await refreshRuntime(false);
      toast({ title: 'Mobile Access restarted', description: 'Devices must pair again.' });
    } catch (error) {
      toast({
        title: 'Could not restart Mobile Access',
        description: errorMessage(error),
        variant: 'destructive',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const requestRestart = () => {
    if (clients.length === 0) {
      void restartGateway();
      return;
    }
    showConfirm({
      title: 'Restart Mobile Access?',
      description:
        'Every paired device will be disconnected and must pair again with a new one-time code.',
      confirmLabel: 'Restart',
      variant: 'destructive',
      onSuccess: () => void restartGateway(),
    });
  };

  const generatePairingCode = async () => {
    setBusyAction('pair');
    try {
      const result = await rpc.mobileAccess.generatePairingCode();
      if (!result.success) throw new Error(result.error.message);
      setPairingCode(result.value);
    } catch (error) {
      toast({
        title: 'Could not generate pairing code',
        description: errorMessage(error),
        variant: 'destructive',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const cancelPairingCode = async () => {
    setBusyAction('cancel-pairing');
    try {
      await rpc.mobileAccess.cancelPairingCode();
      setPairingCode(null);
    } catch (error) {
      toast({
        title: 'Could not cancel pairing code',
        description: errorMessage(error),
        variant: 'destructive',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const revokeClient = async (client: MobileAccessClient) => {
    setBusyAction(`revoke:${client.id}`);
    try {
      const result = await rpc.mobileAccess.revokeClient(client.id);
      if (!result.success) throw new Error(result.error.message);
      setClients((current) => current.filter((candidate) => candidate.id !== client.id));
    } catch (error) {
      toast({
        title: `Could not revoke ${client.name}`,
        description: errorMessage(error),
        variant: 'destructive',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const revokeAllClients = async () => {
    setBusyAction('revoke-all');
    try {
      await rpc.mobileAccess.revokeAllClients();
      setClients([]);
    } catch (error) {
      toast({
        title: 'Could not revoke paired devices',
        description: errorMessage(error),
        variant: 'destructive',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const requestRevokeAll = () => {
    showConfirm({
      title: 'Revoke all paired devices?',
      description: 'All mobile sessions will close immediately. Devices can pair again later.',
      confirmLabel: 'Revoke All',
      variant: 'destructive',
      onSuccess: () => void revokeAllClients(),
    });
  };

  return (
    <div className="space-y-8 pb-10">
      <div className="space-y-4">
        <SettingRow
          title="Mobile Access"
          description="Host a phone-friendly view from this desktop while Emdash is running."
          control={
            <div className="flex items-center gap-3">
              <MobileAccessStatusBadge status={status} />
              <Switch
                aria-label="Enable Mobile Access"
                checked={settings?.enabled ?? false}
                disabled={configBusy}
                onCheckedChange={(enabled) => void handleToggle(enabled)}
              />
            </div>
          }
        />

        <Alert variant="warning">
          <ShieldAlert />
          <AlertTitle>Use only on a trusted private network</AlertTitle>
          <AlertDescription>
            Mobile Access uses unencrypted HTTP and grants paired devices remote terminal and agent
            control, including commands that can modify your files and Git state. Use trusted Wi-Fi
            or a private VPN such as Tailscale or WireGuard. Never forward this port through a
            router or expose it to the public internet.
          </AlertDescription>
        </Alert>

        {status?.error ? (
          <Alert variant="destructive">
            <ShieldAlert />
            <AlertTitle>Mobile Access could not start</AlertTitle>
            <AlertDescription>{status.error}</AlertDescription>
          </Alert>
        ) : null}
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm text-foreground">Network</h3>
            <p className="mt-0.5 text-xs text-foreground-passive">
              Select an address assigned to this computer. Changes restart the mobile server.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busyAction !== null}
            onClick={() => void refreshRuntime()}
          >
            <RefreshCw />
            Refresh
          </Button>
        </div>

        <div className="grid gap-4 rounded-lg border border-border bg-background-secondary-1 p-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
          <label className="min-w-0 space-y-1.5">
            <span className="text-xs text-foreground-muted">Network address</span>
            <Select
              value={draftAddress}
              disabled={configBusy || interfaces.length === 0}
              onValueChange={(value) => {
                if (value) setDraftAddress(value);
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue>
                  {selectedInterface
                    ? `${selectedInterface.name} · ${selectedInterface.address}`
                    : draftAddress
                      ? `${draftAddress} · unavailable`
                      : 'No private IPv4 address found'}
                </SelectValue>
              </SelectTrigger>
              <SelectContent align="start">
                {draftAddress && !selectedInterface ? (
                  <SelectItem value={draftAddress} disabled>
                    {draftAddress} · unavailable
                  </SelectItem>
                ) : null}
                {interfaces.map((networkInterface) => (
                  <SelectItem key={networkInterface.address} value={networkInterface.address}>
                    {networkInterface.name} · {networkInterface.address} ·{' '}
                    {interfaceKindLabel(networkInterface.kind)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          <label className="space-y-1.5">
            <span className="text-xs text-foreground-muted">Port</span>
            <Input
              type="text"
              inputMode="numeric"
              aria-label="Mobile Access port"
              aria-invalid={parsedPort === null}
              value={draftPort}
              disabled={configBusy}
              onChange={(event) => setDraftPort(event.currentTarget.value)}
            />
          </label>

          <div className="flex flex-wrap items-center justify-between gap-3 sm:col-span-2">
            <p className="text-xs text-foreground-passive">
              Port {MOBILE_ACCESS_PORT_MIN}–{MOBILE_ACCESS_PORT_MAX}. The desktop app must remain
              open and awake.
            </p>
            <div className="flex items-center gap-2">
              {settings?.enabled ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={configBusy || status?.state !== 'running'}
                  onClick={requestRestart}
                >
                  {busyAction === 'restart' ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                  Restart
                </Button>
              ) : null}
              <Button
                type="button"
                disabled={configBusy || !endpointChanged || !validAddress || parsedPort === null}
                onClick={requestApplyEndpoint}
              >
                {busyAction === 'apply' ? <Loader2 className="animate-spin" /> : null}
                {settings?.enabled ? 'Apply & Restart' : 'Apply'}
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h3 className="text-sm text-foreground">Connect a phone</h3>
          <p className="mt-0.5 text-xs text-foreground-passive">
            Open the address on your phone, then enter a one-time code generated here.
          </p>
        </div>

        {status?.state === 'running' && status.url ? (
          <div className="space-y-4 rounded-lg border border-border bg-background-secondary-1 p-4">
            <div className="space-y-1.5">
              <span className="text-xs text-foreground-muted">Private network URL</span>
              <div className="flex min-w-0 items-center gap-2 rounded-md bg-background-quaternary-1 px-3 py-2">
                <Wifi className="size-4 shrink-0 text-foreground-muted" />
                <code className="min-w-0 flex-1 truncate text-sm text-foreground">
                  {status.url}
                </code>
                <CopyValueButton value={status.url} label="Mobile Access URL" />
              </div>
            </div>

            {pairingCode ? (
              <div className="rounded-lg border border-border-primary/50 bg-background p-4 text-center">
                <div className="flex items-center justify-center gap-2 text-xs text-foreground-muted">
                  <KeyRound className="size-4" />
                  One-time pairing code
                </div>
                <div className="mt-2 flex items-center justify-center gap-2">
                  <code className="text-2xl tracking-[0.2em] text-foreground">
                    {pairingCode.code.slice(0, 4)} {pairingCode.code.slice(4)}
                  </code>
                  <CopyValueButton value={pairingCode.code} label="pairing code" />
                </div>
                <p className="mt-2 text-xs text-foreground-passive" aria-live="polite">
                  Expires in {Math.floor(remainingPairingSeconds / 60)}:
                  {String(remainingPairingSeconds % 60).padStart(2, '0')} and works once.
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="mt-2"
                  disabled={busyAction !== null}
                  onClick={() => void cancelPairingCode()}
                >
                  Cancel code
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="max-w-lg text-xs text-foreground-passive">
                  Codes expire after five minutes and stop working after five incorrect attempts.
                </p>
                <Button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={() => void generatePairingCode()}
                >
                  {busyAction === 'pair' ? <Loader2 className="animate-spin" /> : <KeyRound />}
                  Generate code
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-foreground-passive">
            Enable Mobile Access to get a private URL and pairing code.
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm text-foreground">Paired devices</h3>
            <p className="mt-0.5 text-xs text-foreground-passive">
              Authorization is cleared whenever the desktop app or mobile server restarts.
            </p>
          </div>
          {clients.length > 1 ? (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={busyAction !== null}
              onClick={requestRevokeAll}
            >
              Revoke all
            </Button>
          ) : null}
        </div>

        {clients.length === 0 ? (
          <div className="rounded-lg border border-border bg-background-secondary-1 p-5 text-center">
            <Smartphone className="mx-auto size-6 text-foreground-passive" />
            <p className="mt-2 text-sm text-foreground-muted">No devices paired this run</p>
          </div>
        ) : (
          <div className="divide-y divide-border/50 rounded-lg border border-border bg-background-secondary-1 p-4">
            {clients.map((client) => (
              <PairedDeviceRow
                key={client.id}
                client={client}
                revoking={busyAction === `revoke:${client.id}`}
                onRevoke={(candidate) => void revokeClient(candidate)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
