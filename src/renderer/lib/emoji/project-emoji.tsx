import { useEffect, useState, type CSSProperties, type HTMLAttributes } from 'react';
import appleSheetUrl from '@/assets/images/emoji/apple-sheet-64.png';
import facebookSheetUrl from '@/assets/images/emoji/facebook-sheet-64.png';
import googleSheetUrl from '@/assets/images/emoji/google-sheet-64.png';
import twitterSheetUrl from '@/assets/images/emoji/twitter-sheet-64.png';
import type { ProjectEmojiSetId } from '@main/core/settings/schema';
import { cn } from '@renderer/utils/utils';

export type { ProjectEmojiSetId };

type EmojiMartSkin = {
  native: string;
  x?: number;
  y?: number;
};

type EmojiMartEmoji = {
  skins: EmojiMartSkin[];
};

export type ProjectEmojiData = {
  sheet: { cols: number; rows: number };
  emojis: Record<string, EmojiMartEmoji>;
};

type EmojiSprite = { native: string; x: number; y: number };

type LoadedSet = {
  id: ProjectEmojiSetId;
  data: ProjectEmojiData;
  spriteByNative: Map<string, EmojiSprite>;
  spritesheetUrl: string | null;
};

const SPRITESHEET_URLS: Record<Exclude<ProjectEmojiSetId, 'native'>, string> = {
  apple: appleSheetUrl,
  google: googleSheetUrl,
  twitter: twitterSheetUrl,
  facebook: facebookSheetUrl,
};

/**
 * Each set's dataset JSON is loaded lazily so the initial bundle stays small.
 * The `native` set has no sprite — we still load its dataset so the picker's
 * search index works, but the renderer falls back to OS font for it.
 */
const datasetLoaders: Record<ProjectEmojiSetId, () => Promise<{ default: ProjectEmojiData }>> = {
  native: () =>
    import('@emoji-mart/data/sets/15/native.json') as Promise<{ default: ProjectEmojiData }>,
  apple: () =>
    import('@emoji-mart/data/sets/15/apple.json') as Promise<{ default: ProjectEmojiData }>,
  google: () =>
    import('@emoji-mart/data/sets/15/google.json') as Promise<{ default: ProjectEmojiData }>,
  twitter: () =>
    import('@emoji-mart/data/sets/15/twitter.json') as Promise<{ default: ProjectEmojiData }>,
  facebook: () =>
    import('@emoji-mart/data/sets/15/facebook.json') as Promise<{ default: ProjectEmojiData }>,
};

const setCache = new Map<ProjectEmojiSetId, Promise<LoadedSet>>();
const settledSets = new Map<ProjectEmojiSetId, LoadedSet>();

function buildSpriteIndex(data: ProjectEmojiData): Map<string, EmojiSprite> {
  const index = new Map<string, EmojiSprite>();
  for (const emoji of Object.values(data.emojis)) {
    for (const skin of emoji.skins) {
      if (typeof skin.x !== 'number' || typeof skin.y !== 'number') continue;
      index.set(skin.native, { native: skin.native, x: skin.x, y: skin.y });
    }
  }
  return index;
}

/**
 * Load (and cache) a set's dataset + spritesheet URL. Cached as a Promise on
 * first call so concurrent callers share the same in-flight import; the
 * resolved value is also cached separately for synchronous reads.
 */
export function loadProjectEmojiSet(setId: ProjectEmojiSetId): Promise<LoadedSet> {
  const cached = setCache.get(setId);
  if (cached) return cached;
  const promise = datasetLoaders[setId]().then(({ default: data }) => {
    const loaded: LoadedSet = {
      id: setId,
      data,
      spriteByNative: buildSpriteIndex(data),
      spritesheetUrl: setId === 'native' ? null : SPRITESHEET_URLS[setId],
    };
    settledSets.set(setId, loaded);
    return loaded;
  });
  setCache.set(setId, promise);
  return promise;
}

/** Hook returning the loaded set or `null` while the JSON is in flight. */
export function useProjectEmojiSet(setId: ProjectEmojiSetId): LoadedSet | null {
  // The initializer reads the settled cache so a previously-loaded set renders
  // synchronously without a flash. The effect then handles `setId` changes by
  // resolving (or awaiting) the cached load promise; React's bailout on
  // identical state means we don't double-render when the new set was already
  // resolved.
  const [loaded, setLoaded] = useState<LoadedSet | null>(() => settledSets.get(setId) ?? null);

  useEffect(() => {
    let cancelled = false;
    void loadProjectEmojiSet(setId).then((next) => {
      if (!cancelled) setLoaded(next);
    });
    return () => {
      cancelled = true;
    };
  }, [setId]);

  return loaded;
}

type ProjectEmojiProps = HTMLAttributes<HTMLSpanElement> & {
  native?: string | null;
  size?: number | string;
  set: ProjectEmojiSetId;
};

export function ProjectEmoji({
  native,
  size = '1em',
  set,
  className,
  ...props
}: ProjectEmojiProps) {
  const loaded = useProjectEmojiSet(set);
  if (!native) return null;

  // Native set, still loading, or no sprites for this set: render the
  // codepoint as text and let the OS font handle it.
  if (set === 'native' || !loaded || !loaded.spritesheetUrl) {
    return (
      <span
        className={cn('inline-flex items-center justify-center leading-none', className)}
        {...props}
      >
        {native}
      </span>
    );
  }

  const sprite = loaded.spriteByNative.get(native);
  if (!sprite) {
    // Codepoint missing from this set's sprite map (e.g. very new emoji).
    // Fall back to native rendering rather than a blank tile.
    return (
      <span
        className={cn('inline-flex items-center justify-center leading-none', className)}
        {...props}
      >
        {native}
      </span>
    );
  }

  const dimension = typeof size === 'number' ? `${size}px` : size;
  const { cols, rows } = loaded.data.sheet;
  const backgroundStyle: CSSProperties = {
    display: 'block',
    width: dimension,
    height: dimension,
    backgroundImage: `url(${loaded.spritesheetUrl})`,
    backgroundSize: `${100 * cols}% ${100 * rows}%`,
    backgroundPosition: `${(100 / (cols - 1)) * sprite.x}% ${(100 / (rows - 1)) * sprite.y}%`,
  };

  return (
    <span
      className={cn('inline-flex items-center justify-center leading-none', className)}
      {...props}
    >
      <span aria-hidden="true" style={backgroundStyle} />
    </span>
  );
}

export const PROJECT_EMOJI_SET_OPTIONS: { id: ProjectEmojiSetId; label: string }[] = [
  { id: 'native', label: 'Native' },
  { id: 'apple', label: 'Apple' },
  { id: 'google', label: 'Google' },
  { id: 'twitter', label: 'Twitter' },
  { id: 'facebook', label: 'Facebook' },
];
