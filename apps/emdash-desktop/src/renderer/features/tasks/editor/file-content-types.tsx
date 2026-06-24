/**
 * FILE_CONTENT_TYPES — single source of truth for file rendering capabilities.
 *
 * Each entry declares:
 *   editable  — true when the file has a Monaco source view (text/csv/markdown/html/svg)
 *   Preview   — present when the file has a rendered preview component
 *
 * The FileContent container derives showSource / showPreview / canToggle from these
 * two flags plus FileTabStore.viewMode. No other mapping or coupling is needed.
 */

import type { ComponentType } from 'react';
import { BinaryRenderer } from '@renderer/lib/editor/binary-renderer';
import { CsvRenderer } from '@renderer/lib/editor/csv-renderer';
import { FileErrorRenderer } from '@renderer/lib/editor/file-error-renderer';
import { HtmlRenderer } from '@renderer/lib/editor/html-renderer';
import { ImageRenderer } from '@renderer/lib/editor/image-renderer';
import { MarkdownEditorRenderer } from '@renderer/lib/editor/markdown-renderer';
import { SvgRenderer } from '@renderer/lib/editor/svg-renderer';
import { TooLargeRenderer } from '@renderer/lib/editor/too-large-renderer';
import type { FileContentType, FileTabStore } from './stores/file-tab-store';

export interface FileContentTypeDef {
  /** True when the file type supports Monaco source editing. */
  editable: boolean;
  /** Present when the file type has a rendered preview component. */
  Preview?: ComponentType<{ tab: FileTabStore }>;
}

// Stable wrapper components so React never sees a new reference on re-render.

function CsvPreview({ tab }: { tab: FileTabStore }) {
  return <CsvRenderer filePath={tab.path} />;
}

function MarkdownPreview({ tab }: { tab: FileTabStore }) {
  return <MarkdownEditorRenderer tab={tab} />;
}

function HtmlPreview({ tab }: { tab: FileTabStore }) {
  return <HtmlRenderer filePath={tab.path} />;
}

function SvgPreview({ tab }: { tab: FileTabStore }) {
  return <SvgRenderer filePath={tab.path} />;
}

function ImagePreview({ tab }: { tab: FileTabStore }) {
  return <ImageRenderer file={tab} />;
}

function TooLargePreview({ tab }: { tab: FileTabStore }) {
  return <TooLargeRenderer file={tab} />;
}

function BinaryPreview({ tab }: { tab: FileTabStore }) {
  return <BinaryRenderer file={tab} />;
}

function FileErrorPreview({ tab }: { tab: FileTabStore }) {
  return <FileErrorRenderer file={tab} />;
}

export const FILE_CONTENT_TYPES: Record<FileContentType, FileContentTypeDef> = {
  text: { editable: true },
  csv: { editable: true, Preview: CsvPreview },
  markdown: { editable: true, Preview: MarkdownPreview },
  html: { editable: true, Preview: HtmlPreview },
  svg: { editable: true, Preview: SvgPreview },
  image: { editable: false, Preview: ImagePreview },
  'too-large': { editable: false, Preview: TooLargePreview },
  binary: { editable: false, Preview: BinaryPreview },
  'file-error': { editable: false, Preview: FileErrorPreview },
};
