import React from 'react';
import { cn } from '@renderer/utils/utils';

type ProjectAvatarSize = 'sm' | 'md' | 'lg';

const SIZE_CLASSES: Record<ProjectAvatarSize, string> = {
  sm: 'h-6 w-6 rounded-md text-[10px]',
  md: 'h-8 w-8 rounded-lg text-xs',
  lg: 'h-14 w-14 rounded-2xl text-base',
};

interface ProjectAvatarProps {
  iconDataUrl: string;
  size?: ProjectAvatarSize;
  className?: string;
}

export const ProjectAvatar: React.FC<ProjectAvatarProps> = ({
  iconDataUrl,
  size = 'md',
  className,
}) => {
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center overflow-hidden font-semibold text-foreground/70',
        SIZE_CLASSES[size],
        className
      )}
    >
      <img
        src={iconDataUrl}
        alt=""
        draggable={false}
        className="block h-full w-full object-cover"
      />
    </span>
  );
};
