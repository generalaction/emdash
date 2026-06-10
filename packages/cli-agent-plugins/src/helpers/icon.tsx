import React from 'react';
import type { ComponentType } from 'react';

export type IconProps = { size?: number; mode?: 'light' | 'dark'; alt?: string };
export type PluginIcon = ComponentType<IconProps>;

/**
 * Normalize the root <svg> element's width/height to 100% so it scales to fill
 * its container regardless of the intrinsic dimensions encoded in the SVG source.
 */
function normalizeSvgDimensions(svg: string): string {
  return svg.replace(/<svg([^>]*)>/, (_match, attrs: string) => {
    const normalized = attrs
      .replace(/\s+width=['"][^'"]*['"]/g, ' width="100%"')
      .replace(/\s+height=['"][^'"]*['"]/g, ' height="100%"');
    return `<svg${normalized}>`;
  });
}

/** Create a plugin Icon from inline SVG markup strings. */
export function inlineSvgIcon(opts: {
  light: string;
  dark?: string;
  invertInDark?: boolean;
  alt?: string;
}): PluginIcon {
  return function SvgIcon({ size = 16, mode = 'light' }: IconProps) {
    const raw = mode === 'dark' && opts.dark ? opts.dark : opts.light;
    const svg = normalizeSvgDimensions(raw);
    const shouldInvert = mode === 'dark' && opts.invertInDark && !opts.dark;
    return React.createElement('span', {
      role: 'img',
      style: {
        display: 'inline-flex',
        width: size,
        height: size,
        overflow: 'hidden',
        flexShrink: 0,
        filter: shouldInvert ? 'invert(1)' : undefined,
      },
      alt: opts.alt ?? '',
      dangerouslySetInnerHTML: { __html: svg },
    });
  };
}

/** Create a plugin Icon from an image data URI (PNG/JPG base64 encoded). */
export function imageIcon(opts: {
  light: string;
  dark?: string;
  invertInDark?: boolean;
  alt?: string;
}): PluginIcon {
  return function ImageIcon({ size = 16, mode = 'light' }: IconProps) {
    const src = mode === 'dark' && opts.dark ? opts.dark : opts.light;
    const shouldInvert = mode === 'dark' && opts.invertInDark && !opts.dark;
    return React.createElement('img', {
      src,
      alt: opts.alt ?? '',
      width: size,
      height: size,
      style: { filter: shouldInvert ? 'invert(1)' : undefined },
    });
  };
}
