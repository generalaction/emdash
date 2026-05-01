import type React from 'react';
import { useCallback, useRef, useState } from 'react';

export function useAttachments() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [attachments, setAttachments] = useState<File[]>([]);

  const addFiles = useCallback((files: File[]) => {
    if (files.length > 0) {
      setAttachments((prev) => [...prev, ...files]);
    }
  }, []);

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const openFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      addFiles(Array.from(event.target.files ?? []));
      event.target.value = '';
    },
    [addFiles]
  );

  const handlePaste = useCallback(
    (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const items = event.clipboardData?.items;
      if (!items) return;

      const imageFiles: File[] = [];
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) imageFiles.push(file);
        }
      }
      addFiles(imageFiles);
    },
    [addFiles]
  );

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const files = Array.from(event.dataTransfer?.files ?? []);
      addFiles(files.filter((file) => file.type.startsWith('image/')));
    },
    [addFiles]
  );

  const handleDragOver = useCallback((event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const reset = useCallback(() => {
    setAttachments([]);
  }, []);

  return {
    attachments,
    fileInputRef,
    removeAttachment,
    openFilePicker,
    handleFileInputChange,
    handlePaste,
    handleDrop,
    handleDragOver,
    reset,
  };
}
