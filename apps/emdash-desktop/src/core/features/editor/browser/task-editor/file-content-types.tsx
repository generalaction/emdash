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
import { HtmlRenderer } from '@core/features/editor/api/browser/renderers/html-renderer';
import type { FileContentType } from '@core/features/editor/api/browser/task-editor/stores/file-tab-resource';
import type { FileTabResource } from '@core/features/editor/api/browser/task-editor/stores/file-tab-resource';
import { BinaryRenderer } from '../renderers/binary-renderer';
import { CsvRenderer } from '../renderers/csv-renderer';
import { FileErrorRenderer } from '../renderers/file-error-renderer';
import { ImageRenderer } from '../renderers/image-renderer';
import { MarkdownEditorRenderer } from '../renderers/markdown-renderer';
import { SvgRenderer } from '../renderers/svg-renderer';
import { TooLargeRenderer } from '../renderers/too-large-renderer';

export interface FileContentTypeDef {
  /** True when the file type supports Monaco source editing. */
  editable: boolean;
  /** Present when the file type has a rendered preview component. */
  Preview?: ComponentType<{ tab: FileTabResource }>;
}

// Stable wrapper components so React never sees a new reference on re-render.

function CsvPreview({ tab }: { tab: FileTabResource }) {
  return <CsvRenderer filePath={tab.path} />;
}

function MarkdownPreview({ tab }: { tab: FileTabResource }) {
  return <MarkdownEditorRenderer tab={tab} />;
}

function HtmlPreview({ tab }: { tab: FileTabResource }) {
  return <HtmlRenderer filePath={tab.path} />;
}

function SvgPreview({ tab }: { tab: FileTabResource }) {
  return <SvgRenderer filePath={tab.path} />;
}

function ImagePreview({ tab }: { tab: FileTabResource }) {
  return <ImageRenderer file={tab} />;
}

function TooLargePreview({ tab }: { tab: FileTabResource }) {
  return <TooLargeRenderer file={tab} />;
}

function BinaryPreview({ tab }: { tab: FileTabResource }) {
  return <BinaryRenderer file={tab} />;
}

function FileErrorPreview({ tab }: { tab: FileTabResource }) {
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
