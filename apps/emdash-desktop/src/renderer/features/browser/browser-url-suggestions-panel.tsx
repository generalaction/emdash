import { Globe, Search } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@renderer/utils/utils';
import {
  browserUrlSuggestionDisplayUrl,
  type BrowserUrlSuggestion,
} from '@shared/browser-url-suggestions';

export function BrowserUrlSuggestionsPanel({
  suggestions,
  activeIndex,
  onSelect,
  onHover,
}: {
  suggestions: BrowserUrlSuggestion[];
  activeIndex: number;
  onSelect: (suggestion: BrowserUrlSuggestion) => void;
  onHover: (index: number) => void;
}) {
  if (suggestions.length === 0) return null;

  return (
    <div
      role="listbox"
      aria-label="URL suggestions"
      className="absolute top-full right-0 left-0 z-50 mt-1 overflow-hidden rounded-md border border-border bg-background-quaternary p-1 shadow-md ring-1 ring-foreground/10"
    >
      {suggestions.map((suggestion, index) => (
        <div key={suggestionKey(suggestion, index)} id={`browser-url-suggestion-${index}`}>
          <BrowserUrlSuggestionRow
            suggestion={suggestion}
            active={index === activeIndex}
            onSelect={() => onSelect(suggestion)}
            onHover={() => onHover(index)}
          />
        </div>
      ))}
    </div>
  );
}

function BrowserUrlSuggestionRow({
  suggestion,
  active,
  onSelect,
  onHover,
}: {
  suggestion: BrowserUrlSuggestion;
  active: boolean;
  onSelect: () => void;
  onHover: () => void;
}) {
  if (suggestion.type === 'search') {
    return (
      <button
        type="button"
        role="option"
        aria-selected={active}
        className={suggestionRowClass(active)}
        onMouseDown={(event) => event.preventDefault()}
        onMouseEnter={onHover}
        onClick={onSelect}
      >
        <Search className="size-4 shrink-0 text-foreground-muted" />
        <span className="min-w-0 truncate">
          Search Google for <span className="text-foreground-info">{suggestion.query}</span>
        </span>
      </button>
    );
  }

  return (
    <BookmarkSuggestionRow
      suggestion={suggestion}
      active={active}
      onSelect={onSelect}
      onHover={onHover}
    />
  );
}

function BookmarkSuggestionRow({
  suggestion,
  active,
  onSelect,
  onHover,
}: {
  suggestion: Extract<BrowserUrlSuggestion, { type: 'bookmark' }>;
  active: boolean;
  onSelect: () => void;
  onHover: () => void;
}) {
  const [failedFaviconUrl, setFailedFaviconUrl] = useState<string | null>(null);
  const faviconUrl = suggestion.faviconUrl;
  const showFavicon = faviconUrl && faviconUrl !== failedFaviconUrl;

  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      className={suggestionRowClass(active)}
      onMouseDown={(event) => event.preventDefault()}
      onMouseEnter={onHover}
      onClick={onSelect}
    >
      {showFavicon ? (
        <img
          src={faviconUrl}
          alt=""
          className="size-4 shrink-0 rounded-sm"
          draggable={false}
          onError={() => setFailedFaviconUrl(faviconUrl)}
        />
      ) : (
        <Globe className="size-4 shrink-0 text-foreground-muted" />
      )}
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-foreground">{suggestion.title}</span>
        <span className="block truncate text-xs text-foreground-muted">
          {browserUrlSuggestionDisplayUrl(suggestion.url)}
        </span>
      </span>
    </button>
  );
}

function suggestionRowClass(active: boolean): string {
  return cn(
    'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-hidden transition-colors',
    active
      ? 'bg-background-quaternary-1 text-foreground'
      : 'text-foreground-muted hover:bg-background-quaternary-1 hover:text-foreground'
  );
}

function suggestionKey(suggestion: BrowserUrlSuggestion, index: number): string {
  if (suggestion.type === 'bookmark') return suggestion.id;
  return `search:${suggestion.query}:${index}`;
}
