import React from 'react';
import { useTheme } from '../hooks/useTheme';

interface AgentLogoProps {
  logo: string;
  alt: string;
  isSvg?: boolean;
  invertInDark?: boolean;
  className?: string;
  grayscale?: boolean;
}

/** Renders an agent logo — handles both raw SVG strings and image URLs with theme awareness. */
const AgentLogo: React.FC<AgentLogoProps> = ({
  logo,
  alt,
  isSvg,
  invertInDark,
  className = 'h-4 w-4',
  grayscale,
}) => {
  const { effectiveTheme } = useTheme();
  const isDark = effectiveTheme === 'dark' || effectiveTheme === 'dark-black';

  const resolvedIsSvg = isSvg ?? logo.trimStart().startsWith('<svg');

  if (resolvedIsSvg) {
    const processed = isDark
      ? logo
          .replace(/\bfill="[^"]*"/g, 'fill="currentColor"')
          .replace(/\bstroke="[^"]*"/g, 'stroke="currentColor"')
      : logo;

    return (
      <span
        role="img"
        aria-label={alt}
        className={`inline-flex shrink-0 items-center justify-center [&_svg]:h-full [&_svg]:w-full [&_svg]:shrink-0 ${isDark ? 'text-primary' : ''} ${grayscale ? 'grayscale' : ''} ${className}`}
        dangerouslySetInnerHTML={{ __html: processed }}
      />
    );
  }

  return (
    <img
      src={logo}
      alt={alt}
      className={`shrink-0 object-contain ${invertInDark ? 'dark:invert' : ''} ${grayscale ? 'grayscale' : ''} ${className}`}
    />
  );
};

export default AgentLogo;
