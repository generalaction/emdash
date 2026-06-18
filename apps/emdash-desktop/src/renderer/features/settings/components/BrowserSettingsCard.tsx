import { Check, Ellipsis, Eraser, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { browserControlsRegistry } from '@renderer/features/browser/browser-controls-registry';
import { browserSessionStore } from '@renderer/features/browser/browser-session-store';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { toast } from '@renderer/lib/hooks/use-toast';
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
  const {
    value: browserSettings,
    update,
    updateAsync,
    isLoading,
    isSaving,
  } = useAppSettingsKey('browser');
  const showConfirm = useShowModal('confirmActionModal');
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const addInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const profiles = browserSettings?.profiles ?? DEFAULT_BROWSER_PROFILES;
  const selectedDefault = normalizeBrowserProfileSelection(
    browserSettings?.defaultProfileId,
    profiles
  );
  const disabled = isLoading || isSaving;

  const addProfile = (name: string) => {
    setIsAdding(false);
    const nextName = name.trim();
    if (!nextName) return;
    const profile: BrowserProfile = { id: makeProfileId(nextName, profiles), name: nextName };
    update({ profiles: [...profiles, profile] });
  };

  const renameProfile = (profileId: string, name: string) => {
    setEditingProfileId(null);
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
        'This clears cookies, local storage, IndexedDB, and cache for this profile. Browser tabs using it will be signed out.',
      confirmLabel: 'Clear Storage',
      variant: 'destructive',
      onSuccess: () => {
        void clearProfileStorageAndReload(profile.id);
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
        void deleteProfileAfterStorageClear({
          deletedProfileId: profile.id,
          replacementProfileId,
          nextProfiles,
          updateAsync,
        });
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

      <div className="rounded-lg border border-border/70 bg-background-1 p-3">
        <div className="flex flex-col gap-1">
          <div className="text-sm text-foreground">Browser profiles</div>
          <div className="text-xs text-foreground-passive">
            Each profile keeps its own cookies and logins, shared across tasks. Profiles do not
            import anything from your system browser.
          </div>
        </div>

        <div className="mt-2 flex flex-col divide-y divide-border/40">
          {profiles.map((profile) => (
            <div key={profile.id} className="flex h-9 items-center gap-2">
              {editingProfileId === profile.id ? (
                <>
                  <Input
                    ref={renameInputRef}
                    autoFocus
                    defaultValue={profile.name}
                    disabled={disabled}
                    aria-label={`Rename ${profile.name} browser profile`}
                    className="h-7 min-w-0 flex-1"
                    onFocus={(event) => event.currentTarget.select()}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter')
                        renameProfile(profile.id, event.currentTarget.value);
                      if (event.key === 'Escape') setEditingProfileId(null);
                    }}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0 text-foreground-muted"
                    disabled={disabled}
                    aria-label={`Save ${profile.name} browser profile name`}
                    onClick={() => renameProfile(profile.id, renameInputRef.current?.value ?? '')}
                  >
                    <Check className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0 text-foreground-muted"
                    disabled={disabled}
                    aria-label={`Cancel renaming ${profile.name} browser profile`}
                    onClick={() => setEditingProfileId(null)}
                  >
                    <X className="size-4" />
                  </Button>
                </>
              ) : (
                <>
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                    {profile.name}
                  </span>
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
                    <DropdownMenuContent
                      align="end"
                      className="min-w-40"
                      finalFocus={renameInputRef}
                    >
                      <DropdownMenuItem onClick={() => setEditingProfileId(profile.id)}>
                        <Pencil className="size-4" />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => clearProfileStorage(profile)}>
                        <Eraser className="size-4" />
                        Clear storage
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        disabled={profiles.length <= 1}
                        onClick={() => deleteProfile(profile)}
                      >
                        <Trash2 className="size-4" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              )}
            </div>
          ))}
        </div>

        <div className="mt-2 flex h-7 items-center">
          {isAdding ? (
            <div className="flex w-full items-center gap-2">
              <Input
                ref={addInputRef}
                autoFocus
                disabled={disabled}
                placeholder="Profile name"
                aria-label="New browser profile name"
                className="h-7 min-w-0 flex-1"
                onKeyDown={(event) => {
                  if (event.key === 'Enter') addProfile(event.currentTarget.value);
                  if (event.key === 'Escape') setIsAdding(false);
                }}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 shrink-0 text-foreground-muted"
                disabled={disabled}
                aria-label="Save new browser profile"
                onClick={() => addProfile(addInputRef.current?.value ?? '')}
              >
                <Check className="size-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 shrink-0 text-foreground-muted"
                disabled={disabled}
                aria-label="Cancel adding profile"
                onClick={() => setIsAdding(false)}
              >
                <X className="size-4" />
              </Button>
            </div>
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

async function clearProfileStorageAndReload(profileId: string): Promise<void> {
  try {
    const result = await rpc.browser.clearProfileStorage(profileId);
    if (!result.success) {
      toast({
        title: 'Could not clear browser storage',
        description: 'The browser profile no longer exists or could not be cleared.',
        variant: 'destructive',
      });
      return;
    }
    reloadBrowserSessionsForProfile(profileId);
  } catch (error) {
    toast({
      title: 'Could not clear browser storage',
      description: errorMessage(error),
      variant: 'destructive',
    });
  }
}

async function deleteProfileAfterStorageClear({
  deletedProfileId,
  replacementProfileId,
  nextProfiles,
  updateAsync,
}: {
  deletedProfileId: string;
  replacementProfileId: string;
  nextProfiles: BrowserProfile[];
  updateAsync: (partial: { profiles: BrowserProfile[]; defaultProfileId: string }) => Promise<void>;
}): Promise<void> {
  let storageCleared = false;
  try {
    const clearResult = await rpc.browser.clearProfileStorage(deletedProfileId);
    if (!clearResult.success) {
      toast({
        title: 'Could not delete browser profile',
        description: 'The profile storage could not be cleared, so the profile was kept.',
        variant: 'destructive',
      });
      return;
    }

    storageCleared = true;
    await updateAsync({
      profiles: nextProfiles,
      defaultProfileId: replacementProfileId,
    });
    browserSessionStore.migrateProfileSessions(
      deletedProfileId,
      replacementProfileId,
      nextProfiles
    );
  } catch (error) {
    if (storageCleared) reloadBrowserSessionsForProfile(deletedProfileId);
    toast({
      title: 'Could not delete browser profile',
      description: storageCleared
        ? `Storage was cleared, but the profile is still listed. ${errorMessage(error)}`
        : errorMessage(error),
      variant: 'destructive',
    });
  }
}

function reloadBrowserSessionsForProfile(profileId: string): void {
  for (const session of browserSessionStore.activeSessions) {
    if (session.profileId !== profileId) continue;
    browserControlsRegistry.get(session.browserId)?.adapter?.reload();
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
