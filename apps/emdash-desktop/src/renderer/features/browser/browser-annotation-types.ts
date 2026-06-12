export type AnnotationRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type AnnotatedElementInfo = {
  selector: string;
  tag: string;
  id: string | null;
  classes: string[];
  testId: string | null;
  role: string | null;
  text: string;
  html: string;
  rect: AnnotationRect;
  /** Nearest React component name, when the page is a React dev build. */
  component: string | null;
  /** JSX source as "file:line" from React dev fibers (_debugSource), when available. */
  source: string | null;
  /** Selected computed styles with non-default values. */
  styles: Record<string, string>;
};

export type BrowserAnnotation = {
  token: number;
  /** Navigation epoch the annotation was created in — page tokens are only unique per epoch. */
  epoch: number;
  comment: string;
  element: AnnotatedElementInfo;
  pageUrl: string;
};

export type AnnotationDraft = {
  token: number;
  element: AnnotatedElementInfo;
  pageUrl: string;
};

export type AnnotationTrackedRect = {
  token: number;
  attached: boolean;
  rect: AnnotationRect | null;
};

export type AnnotationPickerMessage =
  | { type: 'picked'; token: number; element: AnnotatedElementInfo }
  | { type: 'mode'; active: boolean; cancelled?: boolean }
  | { type: 'rects'; rects: AnnotationTrackedRect[] };
