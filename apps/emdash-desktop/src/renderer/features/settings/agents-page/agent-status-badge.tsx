export function InstalledBadge() {
  return (
    <span className="rounded-md bg-background-success px-1.5 py-0.5 text-xs text-foreground-success">
      Installed
    </span>
  );
}

export function UninstalledBadge() {
  return (
    <span className="rounded-md bg-background-2 px-1.5 py-0.5 text-xs text-foreground-passive">
      Not installed
    </span>
  );
}

export function UpdateAvailableBadge() {
  return (
    <span className="rounded-md bg-background-warning px-1.5 py-0.5 text-xs text-foreground-warning">
      Update available
    </span>
  );
}

export function RecommendedBadge() {
  return (
    <span className="rounded-md bg-background-2 px-1.5 py-0.5 text-[10px] text-foreground-passive">
      Recommended
    </span>
  );
}

export function UsedBadge() {
  return (
    <span className="rounded-md bg-background-info px-1.5 py-0.5 text-[10px] text-foreground-info">
      Used
    </span>
  );
}
