export function LastUpdated({ date }: { date: Date }) {
  if (!date || isNaN(date.getTime())) {
    return null;
  }

  const formatted = new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);

  return (
    <div className="border-fd-border mt-10 border-b pb-4">
      <div className="text-fd-muted-foreground flex justify-end text-xs">
        Last updated on {formatted}
      </div>
    </div>
  );
}
