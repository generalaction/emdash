import React from 'react';
import { ExternalLink } from 'lucide-react';
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

interface ExternalLinkModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  onCancel?: () => void;
}

export const ExternalLinkModal: React.FC<ExternalLinkModalProps> = ({
  open,
  onOpenChange,
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
