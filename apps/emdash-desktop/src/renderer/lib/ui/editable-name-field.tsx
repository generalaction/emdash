import { Input } from '@renderer/lib/ui/input';
import { cn } from '@renderer/utils/utils';

interface EditableNameFieldProps {
  value: string;
  onChange: (value: string) => void;
  onBlur?: React.FocusEventHandler<HTMLInputElement>;
  placeholder?: string;
  maxLength?: number;
  autoFocus?: boolean;
  className?: string;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
  disabled?: boolean;
}

export function EditableNameField({
  value,
  onChange,
  onBlur,
  placeholder,
  maxLength,
  autoFocus,
  className,
  onKeyDown,
  disabled,
}: EditableNameFieldProps) {
  return (
    <Input
      autoFocus={autoFocus}
      value={value}
      placeholder={placeholder}
      maxLength={maxLength}
      className={cn('border-none px-0 text-lg! focus-visible:ring-0', className)}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
    />
  );
}
