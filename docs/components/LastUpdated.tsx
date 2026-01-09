export function LastUpdated({ date }: { date: Date }) {
  const formatted = new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);

  return (
    <div className="mt-10 border-b border-fd-border pb-4">
      <div className="flex justify-end text-xs text-fd-muted-foreground">
        Last updated on {formatted}
      </div>
    </div>
  );
}
