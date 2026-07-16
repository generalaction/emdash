import { X } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';

export function BottomSheet({
  open,
  title,
  description,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    document.body.classList.add('sheet-open');
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.classList.remove('sheet-open');
    };
  }, [onClose, open]);

  if (!open) return null;
  return (
    <div className="sheet-layer" role="presentation">
      <button className="sheet-backdrop" type="button" onClick={onClose} aria-label="Close" />
      <section
        className="bottom-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sheet-title"
      >
        <div className="sheet-handle" />
        <header className="sheet-header">
          <div>
            <h2 id="sheet-title">{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </header>
        <div className="sheet-body">{children}</div>
      </section>
    </div>
  );
}
