import { useForm } from '@tanstack/react-form';
import { Trash2 } from 'lucide-react';
import React, { useRef, useState } from 'react';
import type { McpCatalogEntry, McpProvidersResponse, McpServer } from '@shared/mcp/types';
import { Button } from '@renderer/lib/ui/button';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@renderer/lib/ui/field';
import { Input } from '@renderer/lib/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import { KeyValueSection, type KVEntry } from './KeyValueSection';
import { ProviderSelect } from './ProviderSelect';

export type McpModalMode =
  | { type: 'add-catalog'; entry: McpCatalogEntry }
  | { type: 'add-custom' }
  | { type: 'edit'; server: McpServer };

export interface McpModalProps {
  mode: McpModalMode;
  providers: McpProvidersResponse[];
  onSave: (server: McpServer) => Promise<void>;
  onRemove?: (serverName: string) => void;
  onSuccess: (result: unknown) => void;
}

export const McpModal: React.FC<McpModalProps> = ({
  mode,
  providers,
  onSave,
  onRemove,
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
  const [saving, setSaving] = useState(false);

  const form = useForm({
    defaultValues: {
      name: initial.name,
      transport: initial.transport,
      command: initial.command,
      args: initial.args,
      url: initial.url,
      envEntries: toKV(initial.env),
      headerEntries: toKV(initial.headers),
      selectedProviders: initial.providers,
    },
  });

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const v = form.state.values;
      const filledHeaders = v.headerEntries.filter((e) => e.key && e.value);
      const filledEnv = v.envEntries.filter((e) => e.key && e.value);
      const server: McpServer = {
        name: v.name,
        transport: v.transport,
        command: v.transport === 'stdio' ? v.command : undefined,
        args:
          v.transport === 'stdio' && v.args.trim()
            ? v.args.split('\n').filter((a) => a.length > 0)
            : undefined,
        url: v.transport === 'http' ? v.url : undefined,
        headers: filledHeaders.length
          ? Object.fromEntries(filledHeaders.map((e) => [e.key, e.value]))
          : undefined,
        env: filledEnv.length
          ? Object.fromEntries(filledEnv.map((e) => [e.key, e.value]))
          : undefined,
        providers: v.selectedProviders,
      };
      await onSave(server);
      onSuccess(server);
    } catch {
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {isEdit
            ? 'Edit MCP Server'
            : isCatalog
              ? `Add ${form.state.values.name}`
              : 'Add Custom MCP Server'}
        </DialogTitle>
      </DialogHeader>

      <DialogContentArea>
        {isCatalog && mode.entry.description && (
          <p className="text-xs text-muted-foreground">{mode.entry.description}</p>
        )}
        <FieldGroup>
          {/* Name */}
          <form.Field name="name">
            {(field) => (
              <Field>
                <FieldLabel>Server Name</FieldLabel>
                <Input
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  disabled={isCatalog || isEdit}
                  placeholder="my-server"
                />
              </Field>
            )}
          </form.Field>

          {/* Transport */}
          {!isCatalog && (
            <form.Field name="transport">
              {(field) => (
                <Field>
                  <FieldLabel>Transport</FieldLabel>
                  <Select
                    value={field.state.value}
                    onValueChange={(v) => {
                      const next = v as 'stdio' | 'http';
                      field.handleChange(next);
                      if (next === 'http') {
                        form.setFieldValue('selectedProviders', (prev) => {
                          return prev.filter((id) => {
                            const provider = providers.find((p) => p.id === id);
                            return provider?.supportsHttp ?? true;
                          });
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
            </form.Field>
          )}

          {/* Transport-specific fields */}
          <form.Subscribe selector={(state) => state.values.transport}>
            {(transport) => (
              <>
                {transport === 'stdio' && (
                  <>
                    <form.Field name="command">
                      {(field) => (
                        <Field>
                          <FieldLabel>Command</FieldLabel>
                          <Input
                            value={field.state.value}
                            onChange={(e) => field.handleChange(e.target.value)}
                            disabled={isCatalog}
                            placeholder="npx"
                          />
                        </Field>
                      )}
                    </form.Field>
                    <form.Field name="args">
                      {(field) => (
                        <Field>
                          <FieldLabel>Arguments (one per line)</FieldLabel>
                          <textarea
                            value={field.state.value}
                            onChange={(e) => field.handleChange(e.target.value)}
                            disabled={isCatalog}
                            placeholder={'-y\nmy-mcp-server'}
                            rows={3}
                            className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                          />
                        </Field>
                      )}
                    </form.Field>
                  </>
                )}

                {transport === 'http' && (
                  <form.Field name="url">
                    {(field) => (
                      <Field>
                        <FieldLabel>URL</FieldLabel>
                        <Input
                          value={field.state.value}
                          onChange={(e) => field.handleChange(e.target.value)}
                          disabled={isCatalog}
                          placeholder="https://mcp.example.com"
                        />
                      </Field>
                    )}
                  </form.Field>
                )}
              </>
            )}
          </form.Subscribe>

          {/* Env vars — both transports */}
          <form.Field name="envEntries">
            {(field) => (
              <KeyValueSection
                label="Environment Variables"
                entries={field.state.value}
                onChange={(entries) => field.handleChange(entries)}
                addLabel="+ Add env var"
                makeId={makeId}
                credentialKeys={credentialKeys}
              />
            )}
          </form.Field>

          {/* Headers — http only */}
          <form.Subscribe selector={(state) => state.values.transport}>
            {(transport) =>
              transport === 'http' && (
                <form.Field name="headerEntries">
                  {(field) => (
                    <KeyValueSection
                      label="Headers"
                      entries={field.state.value}
                      onChange={(entries) => field.handleChange(entries)}
                      addLabel="+ Add header"
                      makeId={makeId}
                      credentialKeys={credentialKeys}
                    />
                  )}
                </form.Field>
              )
            }
          </form.Subscribe>

          {/* Providers */}
          <form.Field name="selectedProviders">
            {(field) => (
              <form.Subscribe selector={(state) => state.values.transport}>
                {(transport) => (
                  <ProviderSelect
                    providers={providers}
                    selectedProviders={field.state.value}
                    transport={transport}
                    onToggle={(id) => {
                      field.handleChange(
                        field.state.value.includes(id)
                          ? field.state.value.filter((value) => value !== id)
                          : [...field.state.value, id]
                      );
                    }}
                  />
                )}
              </form.Subscribe>
            )}
          </form.Field>
        </FieldGroup>
      </DialogContentArea>

      {/* Actions */}
      <DialogFooter className="gap-2 sm:gap-2">
        {isEdit && onRemove && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => onRemove(form.state.values.name)}
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            Remove
          </Button>
        )}
        <form.Subscribe selector={(state) => state.values}>
          {(values) => {
            const canSave =
              !!values.name.trim() &&
              !saving &&
              values.selectedProviders.length > 0 &&
              !!(values.transport === 'http' ? values.url.trim() : values.command.trim());
            return (
              <ConfirmButton
                type="button"
                onClick={() => void handleSave()}
                disabled={!canSave}
                size="sm"
              >
                {saving ? (isEdit ? 'Saving...' : 'Adding...') : isEdit ? 'Save' : 'Add'}
              </ConfirmButton>
            );
          }}
        </form.Subscribe>
      </DialogFooter>
    </>
  );
};

// ── Helpers ────────────────────────────────────────────────────────────────

function getInitialState(mode: McpModalMode) {
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
