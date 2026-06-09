import { type ComponentPropsWithoutRef, type MouseEvent } from 'react';
import { confirmOpenExternalLink } from '@renderer/lib/open-external-link';

type ExternalLinkProps = Omit<ComponentPropsWithoutRef<'a'>, 'href'> & {
  href: string;
  onOpenError?: (error: unknown) => void;
};

export function ExternalLink({ href, onClick, onOpenError, ...props }: ExternalLinkProps) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;

    event.preventDefault();
    confirmOpenExternalLink(href, onOpenError);
  };

  return <a href={href} rel="noopener noreferrer" onClick={handleClick} {...props} />;
}
