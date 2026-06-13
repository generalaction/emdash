import { Ellipsis, Plus } from 'lucide-react';
import { useState } from 'react';
import { browserSessionStore } from '@renderer/features/browser/browser-session-store';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { rpc } from '@renderer/lib/ipc';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { Input } from '@renderer/lib/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import {
  BROWSER_ISOLATED_PROFILE_ID,
  DEFAULT_BROWSER_PROFILE_ID,
  DEFAULT_BROWSER_PROFILES,
  browserProfileLabel,
  isNamedBrowserProfileId,
  normalizeBrowserProfileSelection,
  type BrowserProfile,
} from '@shared/browser';
import { SettingRow } from './SettingRow';

export function BrowserSettingsCard() {
  const { value: browserSettings, update, isLoading, isSaving } = useAppSettingsKey('browser');
  const showConfirm = useShowModal('confirmActionModal');
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);

  const profiles = browserSettings?.profiles ?? DEFAULT_BROWSER_PROFILES;
  const selectedDefault = normalizeBrowserProfileSelection(
    browserSettings?.defaultProfileId,
    profiles
  );
  const disabled = isLoading || isSaving;

  const addProfile = (name: string) => {
    const nextName = name.trim();
    setIsAdding(false);
    if (!nextName) return;
    const profile: BrowserProfile = { id: makeProfileId(nextName, profiles), name: nextName };
    update({ profiles: [...profiles, profile] });
  };

  const renameProfile = (profileId: string, name: string) => {
    const nextName = name.trim();
    setEditingProfileId(null);
    if (!nextName) return;
    update({
      profiles: profiles.map((profile) =>
        profile.id === profileId ? { ...profile, name: nextName } : profile
      ),
    });
  };

  const clearProfileStorage = (profile: BrowserProfile) => {
    showConfirm({
      title: `Clear ${profile.name} browser storage?`,
      description:
        'This clears cookies, local storage, IndexedDB, and cache for this profile. Browser tabs using it will be signed out.',
      confirmLabel: 'Clear Storage',
      variant: 'destructive',
      onSuccess: () => {
        void rpc.browser.clearProfileStorage(profile.id);
      },
    });
  };

  const deleteProfile = (profile: BrowserProfile) => {
    if (profiles.length <= 1) return;
    showConfirm({
      title: `Delete ${profile.name} browser profile?`,
      description:
        'This removes the profile and clears its cookies, local storage, IndexedDB, and cache.',
      confirmLabel: 'Delete Profile',
      variant: 'destructive',
      onSuccess: () => {
        const nextProfiles = profiles.filter((candidate) => candidate.id !== profile.id);
        const replacementProfileId =
          selectedDefault === profile.id
            ? (nextProfiles[0]?.id ?? DEFAULT_BROWSER_PROFILE_ID)
            : selectedDefault;
        browserSessionStore.migrateProfileSessions(profile.id, replacementProfileId);
        update({
          profiles: nextProfiles,
          defaultProfileId: replacementProfileId,
        });
        void rpc.browser.clearProfileStorage(profile.id);
      },
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <SettingRow
        title="Default browser profile"
        description="New browser tabs open with this profile. You can switch an individual tab's profile from its toolbar menu."
        control={
          <Select
            value={selectedDefault}
            onValueChange={(next) => {
              if (next) update({ defaultProfileId: next });
            }}
            disabled={disabled}
          >
            <SelectTrigger className="w-[190px] shrink-0 gap-2">
              <SelectValue>{browserProfileLabel(selectedDefault, profiles)}</SelectValue>
            </SelectTrigger>
            <SelectContent align="end">
              {profiles.map((profile) => (
                <SelectItem key={profile.id} value={profile.id}>
                  {profile.name}
                </SelectItem>
              ))}
              <SelectItem value={BROWSER_ISOLATED_PROFILE_ID}>Isolated per task</SelectItem>
            </SelectContent>
          </Select>
        }
      />

      <div className="rounded-lg border border-border/70 bg-background-secondary-1 p-3">
        <div className="flex flex-col gap-1">
          <div className="text-sm text-foreground">Browser profiles</div>
          <div className="text-xs text-foreground-passive">
            Each profile keeps its own cookies and logins, shared across tasks. Profiles do not
            import anything from your system browser.
          </div>
        </div>

        <div className="mt-2 flex flex-col">
          {profiles.map((profile) => (
            <div
              key={profile.id}
              className="flex h-9 items-center gap-2 border-b border-border/40 last:border-b-0"
            >
              {editingProfileId === profile.id ? (
                <Input
                  autoFocus
                  defaultValue={profile.name}
                  disabled={disabled}
                  aria-label={`Rename ${profile.name} browser profile`}
                  className="h-7 min-w-0 flex-1"
                  onFocus={(event) => event.currentTarget.select()}
                  onBlur={(event) => renameProfile(profile.id, event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur();
                    if (event.key === 'Escape') setEditingProfileId(null);
                  }}
                />
              ) : (
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                  {profile.name}
                </span>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7 shrink-0 text-foreground-muted"
                      disabled={disabled}
                      aria-label={`${profile.name} browser profile actions`}
                    />
                  }
                >
                  <Ellipsis className="size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-40">
                  <DropdownMenuItem onClick={() => setEditingProfileId(profile.id)}>
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => clearProfileStorage(profile)}>
                    Clear storage
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    disabled={profiles.length <= 1}
                    onClick={() => deleteProfile(profile)}
                  >
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </div>

        <div className="mt-2">
          {isAdding ? (
            <Input
              autoFocus
              disabled={disabled}
              placeholder="Profile name"
              aria-label="New browser profile name"
              className="h-7 w-full"
              onBlur={(event) => addProfile(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
                if (event.key === 'Escape') setIsAdding(false);
              }}
            />
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-foreground-muted"
              disabled={disabled}
              onClick={() => setIsAdding(true)}
            >
              <Plus className="size-4" />
              Add profile
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function makeProfileId(name: string, profiles: readonly BrowserProfile[]): string {
  const existingIds = new Set(profiles.map((profile) => profile.id));
  const base = slugifyProfileName(name) || 'profile';
  let candidate = base;
  let suffix = 2;
  while (existingIds.has(candidate) || !isNamedBrowserProfileId(candidate)) {
    const suffixText = String(suffix);
    const prefixLength = Math.max(1, 63 - suffixText.length);
    candidate = `${base.slice(0, prefixLength)}-${suffixText}`;
    suffix += 1;
  }
  return candidate;
}

function slugifyProfileName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '');
}
