import { cn } from '@/lib/utils';

type Props = {
  files: string[];
  limit?: number;
  className?: string;
};

export default function DeleteRiskFileList({ files, limit = 4, className }: Props) {
  const uniqueFiles = Array.from(new Set(files.filter((file) => file.trim().length > 0)));
  if (uniqueFiles.length === 0) return null;

  const shouldScroll = uniqueFiles.length > limit;

  return (
    <div
      className={cn(
        'ml-6 mt-1 flex flex-wrap gap-1',
        shouldScroll && 'max-h-16 overflow-y-auto pr-1',
        className
      )}
    >
      {uniqueFiles.map((file) => (
        <span
          key={file}
          title={file}
          className="max-w-[220px] truncate rounded-sm border border-amber-300/70 bg-white/70 px-1.5 py-0.5 font-mono text-[11px] text-amber-900 dark:border-amber-400/30 dark:bg-black/10 dark:text-amber-50"
        >
          {file}
        </span>
      ))}
    </div>
  );
}
