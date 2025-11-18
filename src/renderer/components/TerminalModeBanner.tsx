import React from 'react';
import { providerMeta, type UiProvider } from '../providers/meta';

type Props = {
  provider: UiProvider;
  onOpenExternal: (url: string) => void;
};

export const TerminalModeBanner: React.FC<Props> = ({ provider, onOpenExternal }) => {
  const meta = providerMeta[provider];
  const helpUrl = meta?.helpUrl;
  const baseLabel = meta?.label || 'this provider';

  const text = `Interact with ${baseLabel} in the terminal below. To install and get started, see the docs:`;

  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200">
      <div className="whitespace-pre-wrap">{text}</div>
      {helpUrl ? (
        <button
          type="button"
          onClick={() => onOpenExternal(helpUrl)}
          className="mt-1 text-gray-800 underline hover:text-gray-600 dark:text-gray-200 dark:hover:text-gray-100"
        >
          Docs
        </button>
      ) : null}
      <div className="mt-2 text-xs opacity-90">
        The terminal session persists while the app is open. Closing the app will terminate the
        session.
      </div>
    </div>
  );
};

export default TerminalModeBanner;
