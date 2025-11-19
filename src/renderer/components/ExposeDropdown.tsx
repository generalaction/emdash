import { Select, SelectContent, SelectItem, SelectTrigger } from './ui/select';
import { useToast } from '@/hooks/use-toast';

type Mode = 'none' | 'preview' | 'all';

export default function ExposeDropdown({
  workspaceId,
  value,
  disabled,
}: {
  workspaceId: string;
  value: Mode;
  disabled?: boolean;
}) {
  const { toast } = useToast();
  const onChange = async (mode: Mode) => {
    try {
      const res = await (window as any).electronAPI.setExposeMode({ workspaceId, mode });
      if (!res?.ok) throw new Error(res?.error || 'Failed to apply expose mode');
      toast({ title: 'Expose updated', description: `Mode: ${mode}` });
    } catch (e: any) {
      toast({
        title: 'Failed to update expose',
        description: e?.message || String(e),
        variant: 'destructive',
      });
    }
  };

  return (
    <Select value={value} onValueChange={(v) => onChange(v as Mode)} disabled={disabled}>
      <SelectTrigger className="h-8 w-[110px] text-xs">
        <span className="text-xs">Expose: {value}</span>
      </SelectTrigger>
      <SelectContent align="end">
        <SelectItem value="none">None</SelectItem>
        <SelectItem value="preview">Preview only</SelectItem>
        <SelectItem value="all">All</SelectItem>
      </SelectContent>
    </Select>
  );
}
