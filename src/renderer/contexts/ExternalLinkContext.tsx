import React, { createContext, useCallback, useContext, useState } from 'react';
import ExternalLinkModal from '../components/ExternalLinkModal';
import { rpc } from '../core/ipc';

interface ExternalLinkContextType {
  openLinkModal: (url: string) => void;
}

const ExternalLinkContext = createContext<ExternalLinkContextType | undefined>(undefined);

export const useExternalLink = () => {
  const context = useContext(ExternalLinkContext);
  if (!context) {
    throw new Error('useExternalLink must be used within an ExternalLinkProvider');
  }
  return context;
};

interface ExternalLinkProviderProps {
  children: React.ReactNode;
}

export const ExternalLinkProvider: React.FC<ExternalLinkProviderProps> = ({ children }) => {
  const [modalOpen, setModalOpen] = useState(false);
  const [currentUrl, setCurrentUrl] = useState('');

  const openLinkModal = useCallback((url: string) => {
    setCurrentUrl(url);
    setModalOpen(true);
  }, []);

  const handleConfirm = useCallback(() => {
    if (currentUrl) {
      // Use electron's shell API to open the URL safely in the default browser
      rpc.app.openExternal(currentUrl).catch((error) => {
        console.error('Failed to open external link:', error);
      });
    }
    setModalOpen(false);
    setCurrentUrl('');
  }, [currentUrl]);

  const handleCancel = useCallback(() => {
    setModalOpen(false);
    setCurrentUrl('');
  }, []);

  return (
    <ExternalLinkContext.Provider value={{ openLinkModal }}>
      {children}
      <ExternalLinkModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    </ExternalLinkContext.Provider>
  );
};

export default ExternalLinkProvider;
