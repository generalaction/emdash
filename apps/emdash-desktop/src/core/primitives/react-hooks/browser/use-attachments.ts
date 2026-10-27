import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

type Attachment = {
  id: string;
  file: File;
  previewUrl: string;
};

export function useAttachments() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const attachmentsRef = useRef<Attachment[]>([]);
  const nextAttachmentIdRef = useRef(0);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const dragCounterRef = useRef(0);

  const addFiles = useCallback((files: File[]) => {
    if (files.length === 0) return;

    const nextAttachments = [...attachmentsRef.current];
    for (const file of files) {
      const attachment = {
        id: `${file.name}-${file.lastModified}-${nextAttachmentIdRef.current++}`,
        file,
        previewUrl: URL.createObjectURL(file),
      };
      nextAttachments.push(attachment);
      attachmentsRef.current = nextAttachments;
    }
    setAttachments(nextAttachments);
  }, []);

  const removeAttachment = useCallback((index: number) => {
    const removed = attachmentsRef.current[index];
    const nextAttachments = attachmentsRef.current.filter((_, i) => i !== index);
    attachmentsRef.current = nextAttachments;
    setAttachments(nextAttachments);
    if (removed) URL.revokeObjectURL(removed.previewUrl);
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
    (event: React.ClipboardEvent) => {
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
    (event: React.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      dragCounterRef.current = 0;
      setIsDraggingOver(false);
      const files = Array.from(event.dataTransfer?.files ?? []);
      addFiles(files.filter((file) => file.type.startsWith('image/')));
    },
    [addFiles]
  );

  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const handleDragEnter = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    dragCounterRef.current += 1;
    if (dragCounterRef.current === 1) {
      setIsDraggingOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) {
      setIsDraggingOver(false);
    }
  }, []);

  const reset = useCallback(() => {
    attachmentsRef.current.forEach((attachment) => URL.revokeObjectURL(attachment.previewUrl));
    attachmentsRef.current = [];
    setAttachments([]);
    dragCounterRef.current = 0;
    setIsDraggingOver(false);
  }, []);

  useEffect(() => {
    return () => {
      attachmentsRef.current.forEach((attachment) => URL.revokeObjectURL(attachment.previewUrl));
      attachmentsRef.current = [];
    };
  }, []);

  return {
    attachments,
    isDraggingOver,
    fileInputRef,
    removeAttachment,
    openFilePicker,
    handleFileInputChange,
    handlePaste,
    handleDrop,
    handleDragOver,
    handleDragEnter,
    handleDragLeave,
    reset,
  };
}
