import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { browserSessionStore } from '@renderer/features/browser/browser-session-store';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { rpc } from '@renderer/lib/ipc';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
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
  type BrowserProfile,
} from '@shared/browser';
import { SettingRow } from './SettingRow';

export function BrowserSettingsCard() {
  const { value: browserSettings, update, isLoading, isSaving } = useAppSettingsKey('browser');
  const showConfirm = useShowModal('confirmActionModal');
  const [newProfileName, setNewProfileName] = useState('');

  const profiles = browserSettings?.profiles ?? DEFAULT_BROWSER_PROFILES;
  const defaultProfileId = browserSettings?.defaultProfileId ?? DEFAULT_BROWSER_PROFILE_ID;
  const selectedDefault = isAvailableProfile(defaultProfileId, profiles)
    ? defaultProfileId
    : DEFAULT_BROWSER_PROFILE_ID;
  const disabled = isLoading || isSaving;

  const addProfile = () => {
    const name = newProfileName.trim();
    if (!name) return;
    const profile: BrowserProfile = { id: makeProfileId(name, profiles), name };
    update({ profiles: [...profiles, profile], defaultProfileId: profile.id });
    setNewProfileName('');
  };

  const renameProfile = (profileId: string, name: string) => {
    const nextName = name.trim();
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
        'This clears cookies, local storage, IndexedDB, and cache for this in-app browser profile. Browser tabs using this profile will be signed out.',
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
        'This removes the profile from settings and clears its cookies, local storage, IndexedDB, and cache.',
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
        description="New in-app browser tabs use this persistence boundary. Tabs using the same named profile share logins; isolated tabs keep web state scoped to the current task."
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
        <div className="mb-3 flex flex-col gap-1">
          <div className="text-sm text-foreground">Browser profiles</div>
          <div className="text-xs text-foreground-passive">
            Named profiles persist and share authenticated web state across tasks. They do not
            import cookies from your system browser.
          </div>
        </div>

        <div className="flex flex-col gap-2">
          {profiles.map((profile) => (
            <div key={profile.id} className="flex items-center gap-2">
              <Input
                defaultValue={profile.name}
                disabled={disabled}
                aria-label={`Browser profile name: ${profile.name}`}
                className="h-8 min-w-0 flex-1"
                onBlur={(event) => renameProfile(profile.id, event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.currentTarget.blur();
                  }
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => clearProfileStorage(profile)}
              >
                Clear storage
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label={`Delete ${profile.name} browser profile`}
                disabled={disabled || profiles.length <= 1}
                onClick={() => deleteProfile(profile)}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
        </div>

        <div className="mt-3 flex items-center gap-2">
          <Input
            value={newProfileName}
            disabled={disabled}
            placeholder="New profile name"
            aria-label="New browser profile name"
            className="h-8 min-w-0 flex-1"
            onChange={(event) => setNewProfileName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') addProfile();
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || !newProfileName.trim()}
            onClick={addProfile}
          >
            <Plus className="size-4" />
            Add profile
          </Button>
        </div>
      </div>
    </div>
  );
}

function isAvailableProfile(profileId: string, profiles: readonly BrowserProfile[]): boolean {
  return (
    profileId === BROWSER_ISOLATED_PROFILE_ID ||
    profiles.some((profile) => profile.id === profileId)
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
