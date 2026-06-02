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
  const shouldInvert = isDark && !!invertInDark && !logoDark;

  const themedLogo = isDark && logoDark ? logoDark : logo;
  const resolvedIsSvg = isSvg ?? themedLogo.trimStart().startsWith('<svg');

  if (resolvedIsSvg) {
    return (
      <span
        role="img"
        aria-label={alt}
        className={`inline-flex shrink-0 items-center justify-center [&_svg]:h-full [&_svg]:w-full [&_svg]:shrink-0 ${shouldInvert ? 'invert' : ''} ${grayscale ? 'grayscale' : ''} ${className}`}
        dangerouslySetInnerHTML={{ __html: themedLogo }}
      />
    );
  }

  return (
    <img
      src={themedLogo}
      alt={alt}
      className={`shrink-0 object-contain ${shouldInvert ? 'invert' : ''} ${grayscale ? 'grayscale' : ''} ${className}`}
    />
  );
};

export default AgentLogo;
