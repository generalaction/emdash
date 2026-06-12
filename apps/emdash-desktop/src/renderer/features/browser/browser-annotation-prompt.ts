import type { AnnotatedElementInfo, BrowserAnnotation } from './browser-annotation-types';

type AnnotationPromptMode = 'detailed' | 'initial';

export function buildAnnotationPrompt(
  annotations: BrowserAnnotation[],
  { mode = 'detailed' }: { mode?: AnnotationPromptMode } = {}
): string {
  if (mode === 'initial') return buildInitialAnnotationPrompt(annotations);

  const byPage = new Map<string, BrowserAnnotation[]>();
  for (const annotation of annotations) {
    const list = byPage.get(annotation.pageUrl);
    if (list) list.push(annotation);
    else byPage.set(annotation.pageUrl, [annotation]);
  }

  const lines: string[] = [
    'I annotated UI elements in the running app preview. Implement the requested change for each annotated element.',
  ];
  let counter = 0;
  for (const [pageUrl, pageAnnotations] of byPage) {
    lines.push('', `Page: ${pageUrl}`);
    for (const annotation of pageAnnotations) {
      counter += 1;
      lines.push('', `${counter}. ${annotation.comment}`);
      lines.push(...describeElementLines(annotation.element));
    }
  }
  return lines.join('\n');
}

function buildInitialAnnotationPrompt(annotations: BrowserAnnotation[]): string {
  const parts = [
    'I annotated UI elements in the running app preview. Implement the requested changes.',
  ];
  annotations.forEach((annotation, index) => {
    parts.push(
      `${index + 1}. ${singleLine(annotation.comment)} (page: ${singleLine(annotation.pageUrl)}; ${describeElementInline(annotation.element)})`
    );
  });
  return parts.join(' ');
}

function describeElementLines(element: AnnotatedElementInfo): string[] {
  const lines = [`   Element: ${element.selector}`];
  if (element.component) {
    lines.push(
      element.source
        ? `   Component: ${element.component} (${element.source})`
        : `   Component: ${element.component}`
    );
  } else if (element.source) {
    lines.push(`   Source: ${element.source}`);
  }
  const details: string[] = [];
  if (element.testId) details.push(`data-testid="${element.testId}"`);
  if (element.role) details.push(`role="${element.role}"`);
  if (details.length) lines.push(`   Attributes: ${details.join(', ')}`);
  if (element.text) lines.push(`   Text: "${element.text}"`);
  const styles = Object.entries(element.styles)
    .map(([prop, value]) => `${prop}: ${value}`)
    .join('; ');
  if (styles) lines.push(`   Styles: ${styles}`);
  if (element.html) lines.push(`   HTML: ${element.html}`);
  return lines;
}

function describeElementInline(element: AnnotatedElementInfo): string {
  const details = [`selector: ${singleLine(element.selector)}`];
  if (element.component) details.push(`component: ${singleLine(element.component)}`);
  else if (element.source) details.push(`source: ${singleLine(element.source)}`);
  if (element.testId) details.push(`data-testid: ${singleLine(element.testId)}`);
  if (element.role) details.push(`role: ${singleLine(element.role)}`);
  if (element.text) details.push(`text: ${singleLine(element.text)}`);
  return details.join('; ');
}

function singleLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
