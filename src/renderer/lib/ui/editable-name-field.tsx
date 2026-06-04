import { Input } from '@renderer/lib/ui/input';
import { cn } from '@renderer/utils/utils';

interface EditableNameFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
  autoFocus?: boolean;
  className?: string;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
}

export function EditableNameField({
  value,
  onChange,
  placeholder,
  maxLength,
  autoFocus,
  className,
  onKeyDown,
}: EditableNameFieldProps) {
  return (
    <Input
      autoFocus={autoFocus}
      value={value}
      placeholder={placeholder}
      maxLength={maxLength}
      className={cn('border-none px-0 text-lg! focus-visible:ring-0', className)}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
    />
  );
}
