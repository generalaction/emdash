import Picker from '@emoji-mart/react';
import * as Tabs from '@radix-ui/react-tabs';
import { Search } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useMemo, useState } from 'react';
import { getProjectManagerStore } from '@renderer/features/projects/stores/project-selectors';
import {
  PROJECT_EMOJI_DATA,
  PROJECT_EMOJI_SET,
  PROJECT_EMOJI_SPRITESHEET_URL,
  ProjectEmoji,
} from '@renderer/lib/emoji/project-emoji';
import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { Input } from '@renderer/lib/ui/input';
import { cn } from '@renderer/utils/utils';
import {
  lucideIconValue,
  parseProjectIcon,
  PROJECT_COLORS,
  PROJECT_ICON_CATALOG,
  PROJECT_ICON_NAMES,
  projectIconColorClass,
} from './icon-catalog';

type ProjectAppearanceModalArgs = {
  projectId: string;
  currentIcon: string | null;
  currentIconColor: string | null;
};

type Props = BaseModalProps<void> & ProjectAppearanceModalArgs;

type EmojiMartSelection = { native: string };

export const ProjectAppearanceModal = observer(function ProjectAppearanceModal({
  projectId,
  currentIcon,
  currentIconColor,
  onSuccess,
  onClose,
}: Props) {
  const initialParsed = parseProjectIcon(currentIcon);
  const [iconValue, setIconValue] = useState<string | null>(currentIcon);
  const [color, setColor] = useState<string | null>(currentIconColor);
  const [iconSearch, setIconSearch] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsedIcon = parseProjectIcon(iconValue);
  const previewColor = projectIconColorClass(color);

  const filteredIconNames = useMemo(() => {
    const q = iconSearch.trim().toLowerCase();
    if (!q) return PROJECT_ICON_NAMES;
    return PROJECT_ICON_NAMES.filter((name) => name.includes(q));
  }, [iconSearch]);

  async function handleSubmit() {
    setIsSubmitting(true);
    setError(null);
    try {
      const finalColor = parsedIcon.kind === 'lucide' && color !== 'default' ? color : null;
      await getProjectManagerStore().updateProjectAppearance(projectId, iconValue, finalColor);
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update appearance');
      setIsSubmitting(false);
    }
  }

  function handleReset() {
    setIconValue(null);
    setColor(null);
    setIconSearch('');
  }

  const initialTab = initialParsed.kind === 'emoji' ? 'emoji' : 'icons';

  return (
    <>
      <DialogHeader showCloseButton={false}>
        <DialogTitle>Customize project</DialogTitle>
      </DialogHeader>
      <DialogContentArea className="pt-0 max-h-[70vh] overflow-y-auto">
        <Tabs.Root defaultValue={initialTab} className="flex flex-col gap-4">
          <Tabs.List className="flex gap-1 rounded-md bg-background-secondary p-1">
            <Tabs.Trigger
              value="emoji"
              className="flex-1 rounded-md px-3 py-1 text-sm text-foreground-muted data-[state=active]:bg-background data-[state=active]:text-foreground"
            >
              Emoji
            </Tabs.Trigger>
            <Tabs.Trigger
              value="icons"
              className="flex-1 rounded-md px-3 py-1 text-sm text-foreground-muted data-[state=active]:bg-background data-[state=active]:text-foreground"
            >
              Icons
            </Tabs.Trigger>
          </Tabs.List>

          <Tabs.Content value="emoji" className="flex justify-center">
            <Picker
              data={PROJECT_EMOJI_DATA}
              onEmojiSelect={(emoji: EmojiMartSelection) => setIconValue(emoji.native)}
              autoFocus
              previewPosition="none"
              skinTonePosition="none"
              maxFrequentRows={1}
              set={PROJECT_EMOJI_SET}
              getSpritesheetURL={() => PROJECT_EMOJI_SPRITESHEET_URL}
            />
          </Tabs.Content>

          <Tabs.Content value="icons" className="flex flex-col gap-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-foreground-muted" />
              <Input
                value={iconSearch}
                onChange={(e) => setIconSearch(e.target.value)}
                placeholder="Search icons…"
                className="pl-8"
              />
            </div>
            <div className="grid max-h-56 grid-cols-9 gap-1 overflow-y-auto">
              {filteredIconNames.length === 0 && (
                <p className="col-span-9 py-4 text-center text-xs text-foreground-muted">
                  No icons match &ldquo;{iconSearch}&rdquo;.
                </p>
              )}
              {filteredIconNames.map((name) => {
                const Icon = PROJECT_ICON_CATALOG[name];
                if (!Icon) return null;
                const selected = parsedIcon.kind === 'lucide' && parsedIcon.name === name;
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => setIconValue(lucideIconValue(name))}
                    aria-label={name}
                    title={name}
                    className={cn(
                      'flex h-8 w-8 items-center justify-center rounded-md border border-transparent hover:bg-background-secondary',
                      selected && 'border-primary bg-background-secondary'
                    )}
                  >
                    <Icon className={cn('h-4 w-4', selected ? previewColor : 'text-foreground')} />
                  </button>
                );
              })}
            </div>

            <section>
              <p className="mb-2 text-xs font-medium text-foreground-muted">Color</p>
              <div className="flex flex-wrap gap-1.5">
                {PROJECT_COLORS.map((c) => {
                  const selected = (color ?? 'default') === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setColor(c.id)}
                      aria-label={c.label}
                      title={c.label}
                      className={cn(
                        'flex h-7 w-7 items-center justify-center rounded-full border border-border hover:scale-105 transition-transform',
                        selected && 'ring-2 ring-primary ring-offset-2 ring-offset-background'
                      )}
                    >
                      <span
                        className={cn(
                          'h-4 w-4 rounded-full bg-current',
                          c.id === 'default' ? 'text-foreground-muted' : c.className
                        )}
                      />
                    </button>
                  );
                })}
              </div>
            </section>
          </Tabs.Content>
        </Tabs.Root>

        <section className="mt-4 flex items-center gap-3 rounded-md bg-background-secondary px-3 py-2">
          <span className="text-xs font-medium text-foreground-muted">Preview</span>
          <div className="flex h-6 w-6 items-center justify-center">
            {parsedIcon.kind === 'emoji' ? (
              <ProjectEmoji native={parsedIcon.char} className="text-base" />
            ) : parsedIcon.kind === 'lucide' ? (
              <parsedIcon.component className={cn('h-4 w-4', previewColor)} />
            ) : (
              <span className="text-xs text-foreground-muted">default</span>
            )}
          </div>
        </section>

        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      </DialogContentArea>
      <DialogFooter>
        <Button variant="outline" onClick={handleReset} disabled={isSubmitting}>
          Reset
        </Button>
        <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
          Cancel
        </Button>
        <ConfirmButton onClick={() => void handleSubmit()} disabled={isSubmitting}>
          {isSubmitting ? 'Saving…' : 'Save'}
        </ConfirmButton>
      </DialogFooter>
    </>
  );
});
