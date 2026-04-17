import { QuickLinkModal } from './QuickLinkModal';
import type { BaseModalProps } from '@/contexts/ModalProvider';

interface QuickLinkModalOverlayProps {
  owner: string;
  repo: string;
  repoUrl: string;
  onSuccess: (projectPath: string) => void;
  onClose: () => void;
}

export function QuickLinkModalOverlay(props: QuickLinkModalOverlayProps) {
  return <QuickLinkModal {...props} />;
}
