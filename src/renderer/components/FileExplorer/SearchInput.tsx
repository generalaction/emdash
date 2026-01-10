import React from 'react';
import { Search, X } from 'lucide-react';

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  onClear: () => void;
  placeholder?: string;
  disabled?: boolean;
}

export const SearchInput: React.FC<SearchInputProps> = ({
  value,
  onChange,
  onClear,
  placeholder = 'Search',
  disabled = false,
}) => {
  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    onChange(event.target.value);
  };

  const handleClearClick = () => {
    onClear();
  };

  const showClearButton = value.length > 0;

  return (
    <div className="relative">
      <SearchIcon />
      <input
        type="text"
        value={value}
        onChange={handleInputChange}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full rounded-none border border-input bg-background py-1 pl-9 pr-8 text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent disabled:opacity-50"
        aria-label="Search input"
      />
      {showClearButton && <ClearButton onClick={handleClearClick} disabled={disabled} />}
    </div>
  );
};

const SearchIcon: React.FC = () => (
  <Search
    className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
    aria-hidden="true"
  />
);

const ClearButton: React.FC<{ onClick: () => void; disabled?: boolean }> = ({
  onClick,
  disabled = false,
}) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 hover:bg-accent disabled:opacity-50"
    aria-label="Clear search"
    type="button"
  >
    <X className="h-3 w-3" />
  </button>
);

export default SearchInput;
