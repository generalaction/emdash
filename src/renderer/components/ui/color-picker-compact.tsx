import React, { useState, useEffect } from 'react';
import { Input } from './input';
import { Popover, PopoverContent, PopoverTrigger } from './popover';

interface ColorPickerCompactProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function ColorPickerCompact({ label, value, onChange, disabled }: ColorPickerCompactProps) {
  const [inputValue, setInputValue] = useState(value);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    setInputValue(value);
  }, [value]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setInputValue(newValue);
    if (/^#[0-9A-Fa-f]{6}$/.test(newValue)) {
      onChange(newValue);
    }
  };

  const handleColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setInputValue(newValue);
    onChange(newValue);
  };

  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </label>
      <div className="flex items-center gap-1">
        <Popover open={isOpen} onOpenChange={setIsOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={disabled}
              className="h-7 w-7 flex-shrink-0 rounded border border-input shadow-sm transition-colors hover:border-foreground/30 disabled:cursor-not-allowed disabled:opacity-50"
              style={{ backgroundColor: value }}
              aria-label={`Choose color for ${label}`}
            />
          </PopoverTrigger>
          <PopoverContent className="w-auto p-2" align="start" sideOffset={5}>
            <div className="space-y-2">
              <input
                type="color"
                value={value}
                onChange={handleColorChange}
                className="h-32 w-32 cursor-pointer rounded border"
                aria-label={`Color picker for ${label}`}
              />
              <Input
                type="text"
                value={inputValue}
                onChange={handleInputChange}
                placeholder="#000000"
                className="h-8 font-mono text-xs"
                maxLength={7}
              />
            </div>
          </PopoverContent>
        </Popover>
        <Input
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          disabled={disabled}
          placeholder="#000000"
          className="h-7 flex-1 px-2 font-mono text-[11px]"
          maxLength={7}
        />
      </div>
    </div>
  );
}
