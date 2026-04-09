import { File } from 'lucide-react';

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
  const deviconClass = FILENAME_MAP[filename] ?? EXTENSION_MAP[getExtension(filename)];

  if (deviconClass) {
    return (
      <i className={deviconClass} style={{ fontSize: size, lineHeight: 1 }} aria-hidden="true" />
    );
  }

  return <File className={className ?? 'size-3.5 text-foreground-passive shrink-0'} />;
}
