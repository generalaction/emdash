import React from 'react';
import { ExternalLink, AlertTriangle, Globe } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog';
import { Button } from './ui/button';

interface ExternalLinkModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  url: string;
  onConfirm: () => void;
  onCancel?: () => void;
}

export const ExternalLinkModal: React.FC<ExternalLinkModalProps> = ({
  open,
  onOpenChange,
  url,
  onConfirm,
  onCancel,
}) => {
  const handleCancel = () => {
    onOpenChange(false);
    onCancel?.();
  };

  const handleConfirm = () => {
    onOpenChange(false);
    onConfirm();
  };

  // Parse the URL to display the domain
  const getDomain = (urlString: string) => {
    try {
      const urlObj = new URL(urlString);
      return urlObj.hostname;
    } catch {
      return urlString;
    }
  };

  const domain = getDomain(url);

  // Truncate long URLs for display
  const displayUrl = url.length > 80 ? url.substring(0, 77) + '...' : url;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <div className="flex items-center gap-3">
            <AlertDialogTitle className="text-lg">Open External Link?</AlertDialogTitle>
          </div>
        </AlertDialogHeader>

        <div className="space-y-4">
          <AlertDialogDescription className="text-sm">
            This link will open in your default browser outside of Emdash.
          </AlertDialogDescription>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            className="bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90"
          >
            <ExternalLink className="mr-2 h-4 w-4" />
            Open Link
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default ExternalLinkModal;
