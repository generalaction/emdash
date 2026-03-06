import React, { useState, useRef } from 'react';
import { X, Trash2 } from 'lucide-react';
import { DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import type { McpServer, McpCatalogEntry, McpProvidersResponse } from '@shared/mcp/types';
import type { Agent } from '../../types';
import { agentConfig } from '../../lib/agentConfig';
import AgentLogo from '../AgentLogo';

export type McpServerModalMode =
  | { type: 'add-catalog'; entry: McpCatalogEntry }
  | { type: 'add-custom' }
  | { type: 'edit'; server: McpServer };

export interface McpServerModalProps {
  mode: McpServerModalMode;
  providers: McpProvidersResponse[];
  onSave: (server: McpServer) => Promise<void>;
  onRemove?: (serverName: string) => void;
  onClose: () => void;
  onSuccess: (result: unknown) => void;
}

interface KVEntry {
  id: number;
  key: string;
  value: string;
}

export const McpServerModal: React.FC<McpServerModalProps> = ({
  mode,
  providers,
  onSave,
  onRemove,
  onClose,
  onSuccess,
}) => {
  const isEdit = mode.type === 'edit';
  const isCatalog = mode.type === 'add-catalog';
  const credentialKeys = isCatalog
    ? new Map(mode.entry.credentialKeys.map((c) => [c.key, c.required]))
    : new Map<string, boolean>();

  const nextId = useRef(0);
  const makeId = () => nextId.current++;

  const toKV = (entries: [string, string][]): KVEntry[] =>
    entries.map(([k, v]) => ({ id: makeId(), key: k, value: v }));

  const initial = getInitialState(mode);
  const [name, setName] = useState(initial.name);
  const [transport, setTransport] = useState<'stdio' | 'http'>(initial.transport);
  const [command, setCommand] = useState(initial.command);
  const [args, setArgs] = useState(initial.args);
  const [url, setUrl] = useState(initial.url);
  const [envEntries, setEnvEntries] = useState<KVEntry[]>(() => toKV(initial.env));
  const [headerEntries, setHeaderEntries] = useState<KVEntry[]>(() => toKV(initial.headers));
  const [selectedProviders, setSelectedProviders] = useState<Set<string>>(
    new Set(initial.providers)
  );
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const filledHeaders = headerEntries.filter((e) => e.key && e.value);
      const filledEnv = envEntries.filter((e) => e.key && e.value);
      const server: McpServer = {
        name,
        transport,
        command: transport === 'stdio' ? command : undefined,
        args:
          transport === 'stdio' && args.trim()
            ? args.split('\n').filter((a) => a.length > 0)
            : undefined,
        url: transport === 'http' ? url : undefined,
        headers: filledHeaders.length
          ? Object.fromEntries(filledHeaders.map((e) => [e.key, e.value]))
          : undefined,
        env: filledEnv.length
          ? Object.fromEntries(filledEnv.map((e) => [e.key, e.value]))
          : undefined,
        providers: Array.from(selectedProviders),
      };
      await onSave(server);
      onSuccess(server);
    } catch {
      // Stay open — error already shown via toast in onSave
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = () => {
    if (!onRemove) return;
    onRemove(name);
  };

  const toggleProvider = (id: string) => {
    setSelectedProviders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const canSave =
    !!name.trim() && !saving && !!(transport === 'http' ? url.trim() : command.trim());

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>
          {isEdit ? 'Edit MCP Server' : isCatalog ? `Add ${name}` : 'Add Custom MCP Server'}
        </DialogTitle>
      </DialogHeader>

      {isCatalog && mode.entry.description && (
        <p className="text-xs text-muted-foreground">{mode.entry.description}</p>
      )}

      <div className="space-y-4">
        {/* Name */}
        <Field label="Server Name">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={isCatalog || isEdit}
            placeholder="my-server"
          />
        </Field>

        {/* Transport */}
        {!isCatalog && (
          <Field label="Transport">
            <Select
              value={transport}
              onValueChange={(v) => {
                const next = v as 'stdio' | 'http';
                setTransport(next);
                if (next === 'http') {
                  setSelectedProviders((prev) => {
                    const filtered = new Set(prev);
                    for (const id of prev) {
                      const prov = providers.find((p) => p.id === id);
                      if (prov && !prov.supportsHttp) filtered.delete(id);
                    }
                    return filtered;
                  });
                }
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="stdio">stdio</SelectItem>
                <SelectItem value="http">http</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        )}

        {/* Stdio fields */}
        {transport === 'stdio' && (
          <>
            <Field label="Command">
              <Input
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                disabled={isCatalog}
                placeholder="npx"
              />
            </Field>
            <Field label="Arguments (one per line)">
              <textarea
                value={args}
                onChange={(e) => setArgs(e.target.value)}
                disabled={isCatalog}
                placeholder={'-y\nmy-mcp-server'}
                rows={3}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </Field>
          </>
        )}

        {/* HTTP fields */}
        {transport === 'http' && (
          <Field label="URL">
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={isCatalog}
              placeholder="https://mcp.example.com"
            />
          </Field>
        )}

        {/* Env vars — available for both transports */}
        <KeyValueSection
          label="Environment Variables"
          entries={envEntries}
          onChange={setEnvEntries}
          addLabel="+ Add env var"
          makeId={makeId}
          credentialKeys={credentialKeys}
        />

        {/* Headers — http only */}
        {transport === 'http' && (
          <KeyValueSection
            label="Headers"
            entries={headerEntries}
            onChange={setHeaderEntries}
            addLabel="+ Add header"
            makeId={makeId}
            credentialKeys={credentialKeys}
          />
        )}

        {/* Providers */}
        <Field label="Sync to agents">
          <div className="flex flex-wrap gap-2">
            {providers
              .filter((p) => p.installed)
              .map((p) => {
                const unsupported = transport === 'http' && !p.supportsHttp;
                const logo = agentConfig[p.id as Agent];
                return (
                  <Button
                    key={p.id}
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={unsupported}
                    onClick={() => toggleProvider(p.id)}
                    title={unsupported ? `${p.name} does not support HTTP servers` : undefined}
                    className={
                      'gap-1.5 ' +
                      (unsupported
                        ? 'cursor-not-allowed border-border text-muted-foreground/40'
                        : selectedProviders.has(p.id)
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border text-muted-foreground hover:border-primary/50')
                    }
                  >
                    {logo && (
                      <AgentLogo
                        logo={logo.logo}
                        alt={logo.alt}
                        isSvg={logo.isSvg}
                        invertInDark={logo.invertInDark}
                        className="h-4 w-4 rounded-sm"
                        grayscale={unsupported}
                      />
                    )}
                    {p.name}
                  </Button>
                );
              })}
          </div>
          {transport === 'http' && providers.some((p) => p.installed && !p.supportsHttp) && (
            <p className="mt-1.5 text-xs text-muted-foreground">
              Some agents don&apos;t support HTTP servers and are disabled.
            </p>
          )}
        </Field>
      </div>

      {/* Actions */}
      <DialogFooter className="gap-2 sm:gap-2">
        {isEdit && onRemove && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={handleRemove}
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            Remove
          </Button>
        )}
        <Button type="button" onClick={handleSave} disabled={!canSave} size="sm">
          {saving ? (isEdit ? 'Saving...' : 'Adding...') : isEdit ? 'Save' : 'Add'}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
};

// ── Helpers ────────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="mb-1 block text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function KeyValueSection({
  label,
  entries,
  onChange,
  addLabel,
  makeId,
  credentialKeys,
}: {
  label: string;
  entries: KVEntry[];
  onChange: (entries: KVEntry[]) => void;
  addLabel: string;
  makeId: () => number;
  credentialKeys: Map<string, boolean>;
}) {
  return (
    <Field label={label}>
      <div className="space-y-2">
        {entries.map((entry, i) => {
          const isCredential = credentialKeys.has(entry.key);
          const isRequired = credentialKeys.get(entry.key) === true;
          return (
            <div key={entry.id} className="flex items-center gap-2">
              <Input
                value={entry.key}
                onChange={(e) => {
                  const next = [...entries];
                  next[i] = { ...entry, key: e.target.value };
                  onChange(next);
                }}
                className="h-8 w-1/2"
                placeholder="KEY"
              />
              <Input
                value={entry.value}
                onChange={(e) => {
                  const next = [...entries];
                  next[i] = { ...entry, value: e.target.value };
                  onChange(next);
                }}
                className={`h-8 w-1/2 ${
                  isCredential && isRequired && !entry.value
                    ? 'border-amber-400/60 bg-amber-50/10'
                    : ''
                }`}
                placeholder={isCredential ? (isRequired ? 'Required' : 'Optional') : 'value'}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => onChange(entries.filter((_, j) => j !== i))}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          );
        })}
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto p-0 text-xs"
          onClick={() => onChange([...entries, { id: makeId(), key: '', value: '' }])}
        >
          {addLabel}
        </Button>
      </div>
    </Field>
  );
}

function getInitialState(mode: McpServerModalMode) {
  if (mode.type === 'edit') {
    const s = mode.server;
    return {
      name: s.name,
      transport: s.transport,
      command: s.command ?? '',
      args: s.args?.join('\n') ?? '',
      url: s.url ?? '',
      env: Object.entries(s.env ?? {}),
      headers: Object.entries(s.headers ?? {}),
      providers: s.providers,
    };
  }
  if (mode.type === 'add-catalog') {
    const cfg = mode.entry.defaultConfig;
    const isHttp = cfg.type === 'http' || ('url' in cfg && !('command' in cfg));
    const clearPlaceholders = (entries: [string, string][]): [string, string][] =>
      entries.map(([k, v]) => [k, typeof v === 'string' && v.startsWith('YOUR_') ? '' : v]);
    return {
      name: mode.entry.key,
      transport: (isHttp ? 'http' : 'stdio') as 'stdio' | 'http',
      command: (cfg.command as string) ?? '',
      args: Array.isArray(cfg.args) ? (cfg.args as string[]).join('\n') : '',
      url: (cfg.url as string) ?? '',
      env: clearPlaceholders(Object.entries((cfg.env as Record<string, string>) ?? {})),
      headers: clearPlaceholders(Object.entries((cfg.headers as Record<string, string>) ?? {})),
      providers: [] as string[],
    };
  }
  // add-custom
  return {
    name: '',
    transport: 'stdio' as const,
    command: '',
    args: '',
    url: '',
    env: [] as [string, string][],
    headers: [] as [string, string][],
    providers: [] as string[],
  };
}
