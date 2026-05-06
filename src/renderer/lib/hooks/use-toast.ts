import { toast as sonnerToast } from 'sonner';

type ToastAction = {
  label: string;
  onClick: () => void;
};

type Toast = {
  title?: string;
  description?: string;
  variant?: 'default' | 'destructive';
  action?: ToastAction;
};

function toast({ title, description, variant, action }: Toast) {
  const options = {
    description,
    ...(action && { action: { label: action.label, onClick: action.onClick } }),
  };

  if (variant === 'destructive') {
    return sonnerToast.error(title, options);
  }
  return sonnerToast(title ?? '', options);
}

function useToast() {
  return { toast };
}

export { toast, useToast };
