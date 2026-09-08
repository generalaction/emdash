import { cx } from '@styles/index';
import { Dialog } from '@/react/primitives/dialog';
import { generatedDiagramAdapter } from './generated-diagram.adapter.css';
import * as styles from './mermaid-viewer-dialog.css';

export interface MermaidViewerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-rendered Mermaid SVG markup; null when rendering failed. */
  svg: string | null;
  /** Human-readable title shown in the dialog header. */
  title?: string;
}

export function MermaidViewerDialog({ open, onOpenChange, svg, title }: MermaidViewerDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content size="xl">
        <Dialog.Header>
          <Dialog.Title>{title ?? 'Diagram'}</Dialog.Title>
        </Dialog.Header>
        <div className={styles.diagramContainer}>
          {svg ? (
            <div
              className={cx(generatedDiagramAdapter, styles.diagram)}
              data-foreign-adapter="generated-diagram"
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          ) : (
            <p className={styles.unavailable}>Couldn&apos;t render diagram.</p>
          )}
        </div>
      </Dialog.Content>
    </Dialog.Root>
  );
}
