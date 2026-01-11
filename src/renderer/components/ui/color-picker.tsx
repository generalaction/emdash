import React, { useState, useEffect, useRef } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import { Input } from './input';
import { Button } from './button';
import { cn } from '@/lib/utils';

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  label?: string;
  className?: string;
}

export function ColorPicker({ value, onChange, label, className }: ColorPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [tempColor, setTempColor] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTempColor(value);
  }, [value]);

  const handleColorChange = (newColor: string) => {
    setTempColor(newColor);
  };

  const handleApply = () => {
    onChange(tempColor);
    setIsOpen(false);
  };

  const handleCancel = () => {
    setTempColor(value);
    setIsOpen(false);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    if (/^#[0-9A-Fa-f]{0,6}$/.test(newValue)) {
      setTempColor(newValue);
    }
  };

  const handleInputBlur = () => {
    // Ensure it's a valid 6-character hex code
    if (/^#[0-9A-Fa-f]{6}$/.test(tempColor)) {
      onChange(tempColor);
    } else {
      setTempColor(value); // Revert to the original value
    }
  };

  return (
    <div className={cn('flex items-center gap-2', className)}>
      {label && <span className="min-w-[120px] text-sm font-medium">{label}</span>}
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className="h-8 w-20 border-2 p-1"
            style={{ backgroundColor: value }}
            aria-label={`Color picker for ${label || 'color'}`}
          >
            <span className="sr-only">{value}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-3" align="start">
          <div className="space-y-3">
            <div className="space-y-2">
              <label className="text-xs font-medium">Color</label>
              <div className="flex gap-2">
                <input
                  ref={inputRef}
                  type="color"
                  value={tempColor}
                  onChange={(e) => handleColorChange(e.target.value)}
                  className="h-10 w-10 cursor-pointer rounded border"
                />
                <Input
                  type="text"
                  value={tempColor}
                  onChange={handleInputChange}
                  onBlur={handleInputBlur}
                  placeholder="#000000"
                  className="flex-1 font-mono text-sm"
                  maxLength={7}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={handleCancel}>
                Cancel
              </Button>
              <Button type="button" size="sm" onClick={handleApply}>
                Apply
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
      <Input
        type="text"
        value={value}
        onChange={(e) => {
          const newValue = e.target.value;
          if (/^#[0-9A-Fa-f]{0,6}$/.test(newValue)) {
            onChange(newValue);
          }
        }}
        onBlur={() => {
          if (!/^#[0-9A-Fa-f]{6}$/.test(value)) {
            onChange('#000000'); // Default to black if invalid
          }
        }}
        className="w-24 font-mono text-xs"
        placeholder="#000000"
        maxLength={7}
      />
    </div>
  );
}
