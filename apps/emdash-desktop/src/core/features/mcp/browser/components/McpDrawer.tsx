import type {
  McpCatalogEntry,
  McpProvidersResponse,
  McpServer,
} from '@emdash/core/primitives/mcp/api';
import { useForm } from '@tanstack/react-form';
import { Trash2 } from 'lucide-react';
import React, { useRef, useState } from 'react';
import { Button } from '@core/primitives/ui/browser/button';
import { ConfirmButton } from '@core/primitives/ui/browser/confirm-button';
import { Field, FieldGroup, FieldLabel } from '@core/primitives/ui/browser/field';
import { Input } from '@core/primitives/ui/browser/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@core/primitives/ui/browser/select';
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@core/primitives/ui/browser/sheet';
import { KeyValueSection, type KVEntry } from './KeyValueSection';
import { SyncToAgentsSection } from './SyncToAgentsSection';

export type McpDrawerMode =
  | { type: 'add-catalog'; entry: McpCatalogEntry }
  | { type: 'add-custom' }
  | { type: 'edit'; server: McpServer };

interface McpDrawerProps {
  open: boolean;
  mode: McpDrawerMode | null;
  providers: McpProvidersResponse[];
  onOpenChange: (open: boolean) => void;
  onSave: (server: McpServer) => Promise<void>;
  onRemove?: (serverName: string) => void;
}

export const McpDrawer: React.FC<McpDrawerProps> = ({
  open,
  mode,
  providers,
  onOpenChange,
  onSave,
  onRemove,
}) => {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="gap-0 p-0">
        {mode && (
          <McpDrawerContent
            mode={mode}
            providers={providers}
            onOpenChange={onOpenChange}
            onSave={onSave}
            onRemove={onRemove}
          />
        )}
      </SheetContent>
    </Sheet>
  );
};

interface McpDrawerContentProps {
  mode: McpDrawerMode;
  providers: McpProvidersResponse[];
  onOpenChange: (open: boolean) => void;
  onSave: (server: McpServer) => Promise<void>;
  onRemove?: (serverName: string) => void;
}

const McpDrawerContent: React.FC<McpDrawerContentProps> = ({
  mode,
  providers,
  onOpenChange,
  onSave,
  onRemove,
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
      onOpenChange(false);
    } catch {
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <SheetHeader label="MCP Server">
        <SheetTitle>
          {isEdit
            ? 'Edit MCP Server'
            : isCatalog
              ? `Add ${form.state.values.name}`
              : 'Add Custom MCP Server'}
        </SheetTitle>
      </SheetHeader>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {isCatalog && mode.entry.description && (
          <p className="text-muted-foreground mb-4 text-xs">{mode.entry.description}</p>
        )}
        <FieldGroup>
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
                            className="border-input placeholder:text-muted-foreground focus-visible:ring-ring flex w-full rounded-md border bg-background px-3 py-2 text-sm ring-offset-background focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
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

          <form.Field name="envEntries">
            {(field) => (
              <KeyValueSection
                label="Environment Variables"
                entries={field.state.value}
                onChange={(entries) => field.handleChange(entries)}
                addLabel="+ Add env var"
                makeId={makeId}
                credentialKeys={credentialKeys}
                splitEnvPaste
              />
            )}
          </form.Field>

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

          <form.Field name="selectedProviders">
            {(field) => (
              <SyncToAgentsSection
                providers={providers}
                selectedProviders={field.state.value}
                onToggle={(id) => {
                  field.handleChange(
                    field.state.value.includes(id)
                      ? field.state.value.filter((value) => value !== id)
                      : [...field.state.value, id]
                  );
                }}
                onSetAll={(ids) => field.handleChange(ids)}
              />
            )}
          </form.Field>
        </FieldGroup>
      </div>

      <SheetFooter className="flex-row items-center justify-between gap-2 sm:flex-row">
        {isEdit && onRemove ? (
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
        ) : (
          <span />
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
      </SheetFooter>
    </>
  );
};

function getInitialState(mode: McpDrawerMode) {
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
      entries.map(([k, v]) => [k, typeof v === 'string' && v.includes('YOUR_') ? '' : v]);
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
