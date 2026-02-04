import { useEffect, useState } from 'react';

export function useDocumentVisibility(): boolean {
  const [visible, setVisible] = useState(() => {
    if (typeof document === 'undefined') return true;
    return document.visibilityState !== 'hidden';
  });

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onChange = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);

  return visible;
}
