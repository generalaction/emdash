import React, { forwardRef } from 'react';
import { Search, X } from 'lucide-react';

const isMac = typeof navigator !== 'undefined' && /mac|iphone|ipad|ipod/i.test(navigator.platform);
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface SettingsSearchInputProps {
  query: string;
  onQueryChange: (query: string) => void;
}

export const SettingsSearchInput = forwardRef<HTMLInputElement, SettingsSearchInputProps>(
  ({ query, onQueryChange }, ref) => {
    return (
      <div className="relative flex items-center">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={ref}
          type="text"
          placeholder="Search settings..."
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          className="h-9 w-72 rounded-lg border-border/60 bg-muted/40 pl-9 pr-16 text-sm placeholder:text-muted-foreground/60 hover:border-border hover:bg-muted focus:border-primary/50 focus:bg-background"
        />
        <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1.5">
          {query ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => {
                onQueryChange('');
                if (ref && typeof ref === 'object') {
                  ref.current?.focus();
                }
              }}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <kbd className="flex h-6 items-center gap-0.5 rounded-md border border-border/70 bg-muted/60 px-1.5 text-[11px] font-medium text-muted-foreground">
              <span>{isMac ? '⌘' : 'Ctrl'}</span>
              <span>F</span>
            </kbd>
          )}
        </div>
      </div>
    );
  }
);

SettingsSearchInput.displayName = 'SettingsSearchInput';

export default SettingsSearchInput;
