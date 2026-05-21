import { AlertCircle } from 'lucide-react';
import { PRODUCT_NAME } from '@shared/app-identity';

export function ServerUnavailableMessage() {
  return (
    <div className="bg-muted/20 flex items-center gap-2 rounded-md border border-border/60 px-3 py-2">
      <AlertCircle className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
      <p className="text-muted-foreground text-xs">
        {PRODUCT_NAME} server is currently unavailable. Please try again later.
      </p>
    </div>
  );
}
