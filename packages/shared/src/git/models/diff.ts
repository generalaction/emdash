export type ImageBlob = {
  dataUrl: string;
  mimeType: string;
  size: number;
};

export type ImageUnavailableReason = 'unsupported' | 'too-large' | 'lfs-pointer' | 'git-error';

export type ImageReadResult =
  | { kind: 'image'; image: ImageBlob }
  | { kind: 'missing' }
  | { kind: 'unavailable'; reason: ImageUnavailableReason };
