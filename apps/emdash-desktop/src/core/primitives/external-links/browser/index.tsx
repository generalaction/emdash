import { createContext, useContext, type ReactNode } from 'react';

export type OpenExternalLink = (href: string) => void;

const OpenExternalLinkContext = createContext<OpenExternalLink | undefined>(undefined);

export function ExternalLinkProvider({
  children,
  openExternalLink,
}: {
  readonly children: ReactNode;
  readonly openExternalLink: OpenExternalLink;
}) {
  return (
    <OpenExternalLinkContext.Provider value={openExternalLink}>
      {children}
    </OpenExternalLinkContext.Provider>
  );
}

export function useOpenExternalLink(): OpenExternalLink | undefined {
  return useContext(OpenExternalLinkContext);
}
