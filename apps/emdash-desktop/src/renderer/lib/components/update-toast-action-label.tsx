import { ArrowUpRight } from 'lucide-react';

export function createUpdateToastActionLabel() {
  return (
    <span className="flex items-center gap-1.5">
      Update
      <ArrowUpRight className="size-3.5 transition-transform duration-200 group-hover/action:translate-x-px group-hover/action:-translate-y-px" />
    </span>
  );
}
