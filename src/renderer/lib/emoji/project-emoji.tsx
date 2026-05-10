import emojiMartData from '@emoji-mart/data/sets/15/google.json';
import type { CSSProperties, HTMLAttributes } from 'react';
import emojiSpritesheetUrl from '@/assets/images/emoji/google-sheet-64.png';
import { cn } from '@renderer/utils/utils';

type EmojiMartSkin = {
  native: string;
  x?: number;
  y?: number;
};

type EmojiMartEmoji = {
  skins: EmojiMartSkin[];
};

type EmojiMartData = {
  sheet: {
    cols: number;
    rows: number;
  };
  emojis: Record<string, EmojiMartEmoji>;
};

type EmojiSprite = {
  native: string;
  x: number;
  y: number;
};

const projectEmojiData = emojiMartData as EmojiMartData;
const emojiSpriteByNative = new Map<string, EmojiSprite>();

for (const emoji of Object.values(projectEmojiData.emojis)) {
  for (const skin of emoji.skins) {
    if (typeof skin.x !== 'number' || typeof skin.y !== 'number') continue;
    emojiSpriteByNative.set(skin.native, {
      native: skin.native,
      x: skin.x,
      y: skin.y,
    });
  }
}

export const PROJECT_EMOJI_DATA = projectEmojiData;
export const PROJECT_EMOJI_SET = 'google' as const;
export const PROJECT_EMOJI_SPRITESHEET_URL = emojiSpritesheetUrl;

type ProjectEmojiProps = HTMLAttributes<HTMLSpanElement> & {
  native?: string | null;
  size?: number | string;
};

export function ProjectEmoji({ native, size = '1em', className, ...props }: ProjectEmojiProps) {
  if (!native) return null;

  const sprite = emojiSpriteByNative.get(native);
  if (!sprite) {
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
  const backgroundStyle: CSSProperties = {
    display: 'block',
    width: dimension,
    height: dimension,
    backgroundImage: `url(${PROJECT_EMOJI_SPRITESHEET_URL})`,
    backgroundSize: `${100 * PROJECT_EMOJI_DATA.sheet.cols}% ${100 * PROJECT_EMOJI_DATA.sheet.rows}%`,
    backgroundPosition: `${(100 / (PROJECT_EMOJI_DATA.sheet.cols - 1)) * sprite.x}% ${(100 / (PROJECT_EMOJI_DATA.sheet.rows - 1)) * sprite.y}%`,
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
