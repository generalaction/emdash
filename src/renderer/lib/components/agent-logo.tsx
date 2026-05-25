import React from 'react';
import { useTheme } from '../hooks/useTheme';

interface AgentLogoProps {
  logo: string;
  logoDark?: string;
  alt: string;
  isSvg?: boolean;
  invertInDark?: boolean;
  className?: string;
  grayscale?: boolean;
}

/** Renders an agent logo — handles both raw SVG strings and image URLs with theme awareness. */
const AgentLogo: React.FC<AgentLogoProps> = ({
  logo,
  logoDark,
  alt,
  isSvg,
  invertInDark,
  className = 'h-4 w-4',
  grayscale,
}) => {
  const { effectiveTheme } = useTheme();
  const isDark = effectiveTheme === 'emdark';

  const themedLogo = isDark && logoDark ? logoDark : logo;
  const resolvedIsSvg = isSvg ?? themedLogo.trimStart().startsWith('<svg');

  if (resolvedIsSvg) {
    const processed =
      isDark && invertInDark && !logoDark
        ? themedLogo
            .replace(/\bfill="[^"]*"/g, 'fill="currentColor"')
            .replace(/\bstroke="[^"]*"/g, 'stroke="currentColor"')
        : themedLogo;

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
      src={themedLogo}
      alt={alt}
      className={`shrink-0 object-contain ${invertInDark ? 'dark:invert' : ''} ${grayscale ? 'grayscale' : ''} ${className}`}
    />
  );
};

export default AgentLogo;
