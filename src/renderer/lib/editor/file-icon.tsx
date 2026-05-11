import { File, FileImage } from 'lucide-react';

/** Maps a file extension (or full filename for extensionless files) to a devicon class name. */
const EXTENSION_MAP: Record<string, string> = {
  // TypeScript / JavaScript
  ts: 'devicon-typescript-plain colored',
  tsx: 'devicon-react-original colored',
  js: 'devicon-javascript-plain colored',
  jsx: 'devicon-react-original colored',
  mjs: 'devicon-javascript-plain colored',
  cjs: 'devicon-javascript-plain colored',

  // Web
  html: 'devicon-html5-plain colored',
  css: 'devicon-css3-plain colored',
  scss: 'devicon-sass-original colored',
  sass: 'devicon-sass-original colored',

  // Data / config
  json: 'devicon-json-plain colored',
  yaml: 'devicon-yaml-plain colored',
  yml: 'devicon-yaml-plain colored',

  // Markup
  md: 'devicon-markdown-original',
  mdx: 'devicon-markdown-original',

  // Python
  py: 'devicon-python-plain colored',

  // Go
  go: 'devicon-go-original colored',

  // Rust
  rs: 'devicon-rust-original',

  // PHP
  php: 'devicon-php-plain colored',

  // Ruby
  rb: 'devicon-ruby-plain colored',

  // Java
  java: 'devicon-java-plain colored',

  // C family
  c: 'devicon-c-plain colored',
  cpp: 'devicon-cplusplus-plain colored',
  cc: 'devicon-cplusplus-plain colored',
  cxx: 'devicon-cplusplus-plain colored',
  cs: 'devicon-csharp-plain colored',

  // Shell
  sh: 'devicon-bash-plain colored',
  bash: 'devicon-bash-plain colored',
  zsh: 'devicon-bash-plain colored',

  // Frontend frameworks
  vue: 'devicon-vuejs-plain colored',
  svelte: 'devicon-svelte-plain colored',
};

/** Full-filename overrides for extensionless files. */
const FILENAME_MAP: Record<string, string> = {
  Dockerfile: 'devicon-docker-plain colored',
  dockerfile: 'devicon-docker-plain colored',
  '.gitignore': 'devicon-git-plain colored',
  '.gitattributes': 'devicon-git-plain colored',
  '.gitmodules': 'devicon-git-plain colored',
};

const IMAGE_ICON_META: Record<string, { label: string; className: string }> = {
  png: { label: 'PNG', className: 'text-sky-500' },
  jpg: { label: 'JPG', className: 'text-emerald-500' },
  jpeg: { label: 'JPG', className: 'text-emerald-500' },
  gif: { label: 'GIF', className: 'text-fuchsia-500' },
  webp: { label: 'WEBP', className: 'text-violet-500' },
  svg: { label: 'SVG', className: 'text-orange-500' },
  bmp: { label: 'BMP', className: 'text-cyan-500' },
  ico: { label: 'ICO', className: 'text-amber-500' },
};

function getExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : '';
}

interface FileIconProps {
  filename: string;
  className?: string;
  size?: number;
}

export function FileIcon({ filename, className, size = 12 }: FileIconProps) {
  const extension = getExtension(filename);
  const deviconClass = FILENAME_MAP[filename] ?? EXTENSION_MAP[extension];

  if (deviconClass) {
    return (
      <i className={deviconClass} style={{ fontSize: size, lineHeight: 1 }} aria-hidden="true" />
    );
  }

  const imageMeta = IMAGE_ICON_META[extension];
  if (imageMeta) {
    return (
      <span
        className="relative inline-flex shrink-0 items-center justify-center"
        style={{ width: size, height: size }}
        title={`${imageMeta.label} image`}
      >
        <FileImage
          className={className ?? `shrink-0 ${imageMeta.className}`}
          style={{ width: size, height: size }}
          aria-hidden="true"
        />
        {size >= 16 && (
          <span className="absolute -bottom-1 rounded-[2px] bg-background px-0.5 font-mono text-[6px] leading-none text-foreground-muted">
            {imageMeta.label.slice(0, 3)}
          </span>
        )}
      </span>
    );
  }

  return (
    <File
      className={className ?? 'shrink-0 text-foreground-passive'}
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
}
