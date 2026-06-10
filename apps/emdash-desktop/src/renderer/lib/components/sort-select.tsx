import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';

/**
 * Compact, label-prefixed sort dropdown shared by list views (tasks, pull requests).
 * Renders as a borderless trigger so it blends into a filter toolbar.
 */
export function SortSelect<T extends string>({
  value,
  options,
  onValueChange,
  label = 'Sort',
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onValueChange: (value: T) => void;
  label?: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-sm text-foreground-passive">{label}</span>
      <Select
        value={value}
        onValueChange={(next) => {
          if (next) onValueChange(next as T);
        }}
      >
        <SelectTrigger
          size="sm"
          className="w-auto gap-1 border-none p-0 text-foreground-muted hover:text-foreground"
        >
          <SelectValue>
            {(selected: T | null) =>
              options.find((option) => option.value === selected)?.label ?? selected
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent align="start" alignItemWithTrigger={false} className="w-auto min-w-44">
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
