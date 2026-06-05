export function TaskPlaceholder({ name }: { name: string | null }) {
  return (
    <div className="flex min-w-0 items-center">
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground-muted">
        {name ?? 'Creating task…'}
      </span>
    </div>
  );
}
