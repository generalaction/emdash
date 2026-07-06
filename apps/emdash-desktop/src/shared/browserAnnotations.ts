export type BrowserAnnotationKind = 'element' | 'text' | 'area';

export type BrowserAnnotationStatus = 'pending' | 'sent' | 'dismissed';

export type BrowserAnnotationBoundingBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type BrowserAnnotationTarget = {
  kind: BrowserAnnotationKind;
  url: string;
  title?: string;
  elementPath: string;
  element: string;
  cssClasses?: string;
  nearbyText?: string;
  selectedText?: string;
  x: number;
  y: number;
  boundingBox: BrowserAnnotationBoundingBox;
};

export type BrowserAnnotation = BrowserAnnotationTarget & {
  id: string;
  taskId: string;
  browserId: string;
  status: BrowserAnnotationStatus;
  comment: string;
  createdAt: string;
  updatedAt: string;
};

type FormatOptions = {
  includeIntro?: boolean;
  leadingNewline?: boolean;
};

function escapeXmlText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function escapeXmlAttribute(value: string | number): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function optionalAttribute(name: string, value: string | number | undefined): string {
  if (value === undefined || value === '') return '';
  return ` ${name}="${escapeXmlAttribute(value)}"`;
}

function annotationAttributes(annotation: BrowserAnnotation): string {
  const { boundingBox } = annotation;
  return [
    `id="${escapeXmlAttribute(annotation.id)}"`,
    `kind="${escapeXmlAttribute(annotation.kind)}"`,
    `status="${escapeXmlAttribute(annotation.status)}"`,
    `url="${escapeXmlAttribute(annotation.url)}"`,
    optionalAttribute('title', annotation.title),
    `elementPath="${escapeXmlAttribute(annotation.elementPath)}"`,
    `element="${escapeXmlAttribute(annotation.element)}"`,
    optionalAttribute('cssClasses', annotation.cssClasses),
    `x="${escapeXmlAttribute(annotation.x)}"`,
    `y="${escapeXmlAttribute(annotation.y)}"`,
    `box="${escapeXmlAttribute(
      `${boundingBox.x},${boundingBox.y},${boundingBox.width},${boundingBox.height}`
    )}"`,
  ]
    .filter(Boolean)
    .join(' ');
}

function annotationBlock(annotation: BrowserAnnotation): string {
  const selectedText = annotation.selectedText
    ? `\n    <selected_text>${escapeXmlText(annotation.selectedText)}</selected_text>`
    : '';
  const nearbyText = annotation.nearbyText
    ? `\n    <nearby_text>${escapeXmlText(annotation.nearbyText)}</nearby_text>`
    : '';

  return `  <annotation ${annotationAttributes(annotation)}>
    <comment>${escapeXmlText(annotation.comment)}</comment>${selectedText}${nearbyText}
  </annotation>`;
}

const ANNOTATIONS_WRAPPER = (
  blocks: string[]
) => `The user has left the following annotations on rendered browser pages:

<browser_annotations>
${blocks.join('\n')}
</browser_annotations>`;

export function formatBrowserAnnotationsForAgent(
  annotations: BrowserAnnotation[],
  { includeIntro = false, leadingNewline = false }: FormatOptions = {}
): string {
  const pending = annotations.filter((annotation) => annotation.status === 'pending');
  if (!pending.length) return '';

  const prefix = leadingNewline ? '\n' : '';
  const blocks = pending
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map(annotationBlock);

  if (includeIntro) {
    return `${prefix}${ANNOTATIONS_WRAPPER(blocks)}`;
  }

  return `${prefix}<browser_annotations>\n${blocks.join('\n')}\n</browser_annotations>`;
}
