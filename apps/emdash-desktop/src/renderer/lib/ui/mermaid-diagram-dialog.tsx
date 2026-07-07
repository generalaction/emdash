import { ZoomableContentDialog } from './zoomable-content-dialog';

interface MermaidDiagramDialogProps {
  open: boolean;
  svg: string;
  renderKey: string;
  onOpenChange: (open: boolean) => void;
}

export function MermaidDiagramDialog({
  open,
  svg,
  renderKey,
  onOpenChange,
}: MermaidDiagramDialogProps) {
  return (
    <ZoomableContentDialog
      open={open}
      ariaLabel="Mermaid diagram"
      contentKey={renderKey}
      onOpenChange={onOpenChange}
      wrapperClassName="rounded-md bg-muted/20"
    >
      {() => (
        <div
          className="text-foreground [&_svg]:block [&_svg]:h-auto [&_svg]:max-w-none"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      )}
    </ZoomableContentDialog>
  );
}
