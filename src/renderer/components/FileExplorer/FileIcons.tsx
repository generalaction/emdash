import React, { Component, ErrorInfo, ReactNode, memo } from 'react';
import {
  VscFile,
  VscFolder,
  VscFolderOpened,
  VscJson,
  VscMarkdown,
  VscFileCode,
  VscFileBinary,
  VscFileMedia,
  VscFilePdf,
  VscFileZip,
  VscTerminal,
  VscSettingsGear,
  VscDatabase,
  VscLock,
  VscKey,
  VscTable,
  VscSymbolMisc,
  VscError,
} from 'react-icons/vsc';
import {
  SiTypescript,
  SiJavascript,
  SiReact,
  SiPython,
  SiHtml5,
  SiCss3,
  SiSass,
  SiNodedotjs,
  SiNpm,
  SiYarn,
  SiDocker,
  SiGit,
  SiGo,
  SiRust,
  SiCplusplus,
  SiPhp,
  SiRuby,
  SiSwift,
  SiKotlin,
  SiLua,
  SiVuedotjs,
  SiAngular,
  SiSvelte,
  SiNextdotjs,
  SiGraphql,
  SiPostgresql,
  SiMongodb,
  SiRedis,
  SiWebpack,
  SiVite,
  SiEslint,
  SiPrettier,
  SiJest,
  SiCypress,
  SiStorybook,
  SiTailwindcss,
  SiBabel,
} from 'react-icons/si';
import { DiCoffeescript } from 'react-icons/di';
import { FaFileImage } from 'react-icons/fa';

// Icon mapping configuration
const SPECIAL_FILES: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  'package.json': { icon: SiNpm, color: 'text-red-500', label: 'NPM package file' },
  'package-lock.json': { icon: SiNpm, color: 'text-red-400', label: 'NPM lock file' },
  'yarn.lock': { icon: SiYarn, color: 'text-blue-400', label: 'Yarn lock file' },
  'pnpm-lock.yaml': { icon: SiNpm, color: 'text-orange-500', label: 'PNPM lock file' },
  '.gitignore': { icon: SiGit, color: 'text-orange-600', label: 'Git ignore file' },
  '.gitattributes': { icon: SiGit, color: 'text-orange-600', label: 'Git attributes file' },
  '.gitmodules': { icon: SiGit, color: 'text-orange-600', label: 'Git modules file' },
  dockerfile: { icon: SiDocker, color: 'text-blue-500', label: 'Docker file' },
  'docker-compose.yml': { icon: SiDocker, color: 'text-blue-500', label: 'Docker compose file' },
  'docker-compose.yaml': { icon: SiDocker, color: 'text-blue-500', label: 'Docker compose file' },
  '.dockerignore': { icon: SiDocker, color: 'text-blue-400', label: 'Docker ignore file' },
  '.env': { icon: VscSettingsGear, color: 'text-yellow-600', label: 'Environment variables file' },
  '.env.local': {
    icon: VscSettingsGear,
    color: 'text-yellow-600',
    label: 'Local environment file',
  },
  '.env.production': {
    icon: VscSettingsGear,
    color: 'text-yellow-600',
    label: 'Production environment file',
  },
  '.env.development': {
    icon: VscSettingsGear,
    color: 'text-yellow-600',
    label: 'Development environment file',
  },
  '.eslintrc': { icon: SiEslint, color: 'text-purple-600', label: 'ESLint config' },
  '.eslintrc.js': { icon: SiEslint, color: 'text-purple-600', label: 'ESLint config' },
  '.eslintrc.json': { icon: SiEslint, color: 'text-purple-600', label: 'ESLint config' },
  '.prettierrc': { icon: SiPrettier, color: 'text-pink-500', label: 'Prettier config' },
  '.prettierrc.js': { icon: SiPrettier, color: 'text-pink-500', label: 'Prettier config' },
  '.prettierrc.json': { icon: SiPrettier, color: 'text-pink-500', label: 'Prettier config' },
  'vite.config.js': { icon: SiVite, color: 'text-purple-500', label: 'Vite config' },
  'vite.config.ts': { icon: SiVite, color: 'text-purple-500', label: 'Vite config' },
  'webpack.config.js': { icon: SiWebpack, color: 'text-blue-600', label: 'Webpack config' },
  'rollup.config.js': { icon: VscFileCode, color: 'text-red-600', label: 'Rollup config' },
  'babel.config.js': { icon: SiBabel, color: 'text-yellow-500', label: 'Babel config' },
  '.babelrc': { icon: SiBabel, color: 'text-yellow-500', label: 'Babel config' },
  'jest.config.js': { icon: SiJest, color: 'text-red-600', label: 'Jest config' },
  'cypress.config.js': { icon: SiCypress, color: 'text-green-600', label: 'Cypress config' },
  'tailwind.config.js': { icon: SiTailwindcss, color: 'text-cyan-500', label: 'Tailwind config' },
  'postcss.config.js': { icon: VscFileCode, color: 'text-orange-600', label: 'PostCSS config' },
  'next.config.js': {
    icon: SiNextdotjs,
    color: 'text-gray-800 dark:text-white',
    label: 'Next.js config',
  },
  'nuxt.config.js': { icon: VscFileCode, color: 'text-green-600', label: 'Nuxt config' },
  'angular.json': { icon: SiAngular, color: 'text-red-600', label: 'Angular config' },
  'readme.md': { icon: VscMarkdown, color: 'text-blue-600', label: 'README file' },
  license: { icon: VscLock, color: 'text-yellow-600', label: 'License file' },
  'license.md': { icon: VscLock, color: 'text-yellow-600', label: 'License file' },
  makefile: { icon: VscSettingsGear, color: 'text-orange-600', label: 'Makefile' },
};

const EXTENSION_ICONS: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  // JavaScript/TypeScript
  ts: { icon: SiTypescript, color: 'text-blue-600', label: 'TypeScript file' },
  tsx: { icon: SiReact, color: 'text-cyan-500', label: 'TypeScript React file' },
  js: { icon: SiJavascript, color: 'text-yellow-500', label: 'JavaScript file' },
  jsx: { icon: SiReact, color: 'text-cyan-500', label: 'JavaScript React file' },
  mjs: { icon: SiJavascript, color: 'text-yellow-500', label: 'JavaScript module' },
  cjs: { icon: SiNodedotjs, color: 'text-green-600', label: 'CommonJS module' },
  coffee: { icon: DiCoffeescript, color: 'text-brown-600', label: 'CoffeeScript file' },

  // Web
  html: { icon: SiHtml5, color: 'text-orange-600', label: 'HTML file' },
  htm: { icon: SiHtml5, color: 'text-orange-600', label: 'HTML file' },
  css: { icon: SiCss3, color: 'text-blue-600', label: 'CSS file' },
  scss: { icon: SiSass, color: 'text-pink-600', label: 'SCSS file' },
  sass: { icon: SiSass, color: 'text-pink-600', label: 'Sass file' },
  less: { icon: VscFileCode, color: 'text-blue-800', label: 'Less file' },
  styl: { icon: VscFileCode, color: 'text-green-600', label: 'Stylus file' },

  // Frameworks
  vue: { icon: SiVuedotjs, color: 'text-green-600', label: 'Vue file' },
  svelte: { icon: SiSvelte, color: 'text-orange-600', label: 'Svelte file' },

  // Data
  json: { icon: VscJson, color: 'text-yellow-600', label: 'JSON file' },
  jsonc: { icon: VscJson, color: 'text-yellow-600', label: 'JSON with comments' },
  json5: { icon: VscJson, color: 'text-yellow-600', label: 'JSON5 file' },
  xml: { icon: VscFileCode, color: 'text-orange-500', label: 'XML file' },
  yaml: { icon: VscFileCode, color: 'text-red-600', label: 'YAML file' },
  yml: { icon: VscFileCode, color: 'text-red-600', label: 'YAML file' },
  toml: { icon: VscFileCode, color: 'text-gray-600', label: 'TOML file' },
  ini: { icon: VscSettingsGear, color: 'text-gray-600', label: 'INI file' },
  env: { icon: VscSettingsGear, color: 'text-yellow-600', label: 'Environment file' },
  graphql: { icon: SiGraphql, color: 'text-pink-600', label: 'GraphQL file' },
  gql: { icon: SiGraphql, color: 'text-pink-600', label: 'GraphQL file' },

  // Programming Languages
  py: { icon: SiPython, color: 'text-blue-500', label: 'Python file' },
  pyc: { icon: SiPython, color: 'text-blue-400', label: 'Python compiled' },
  pyw: { icon: SiPython, color: 'text-blue-500', label: 'Python Windows file' },
  pyx: { icon: SiPython, color: 'text-blue-600', label: 'Cython file' },
  pyi: { icon: SiPython, color: 'text-yellow-600', label: 'Python interface' },
  go: { icon: SiGo, color: 'text-cyan-600', label: 'Go file' },
  rs: { icon: SiRust, color: 'text-orange-700', label: 'Rust file' },
  java: { icon: VscFileCode, color: 'text-red-600', label: 'Java file' },
  class: { icon: VscFileCode, color: 'text-red-500', label: 'Java class file' },
  jar: { icon: VscFileCode, color: 'text-red-700', label: 'Java archive' },
  c: { icon: VscFileCode, color: 'text-blue-800', label: 'C file' },
  cpp: { icon: SiCplusplus, color: 'text-blue-600', label: 'C++ file' },
  cc: { icon: SiCplusplus, color: 'text-blue-600', label: 'C++ file' },
  cxx: { icon: SiCplusplus, color: 'text-blue-600', label: 'C++ file' },
  h: { icon: VscFileCode, color: 'text-purple-600', label: 'Header file' },
  hpp: { icon: SiCplusplus, color: 'text-purple-600', label: 'C++ header' },
  php: { icon: SiPhp, color: 'text-purple-600', label: 'PHP file' },
  rb: { icon: SiRuby, color: 'text-red-600', label: 'Ruby file' },
  swift: { icon: SiSwift, color: 'text-orange-600', label: 'Swift file' },
  kt: { icon: SiKotlin, color: 'text-purple-600', label: 'Kotlin file' },
  lua: { icon: SiLua, color: 'text-blue-800', label: 'Lua file' },
  r: { icon: VscFileCode, color: 'text-blue-600', label: 'R file' },
  dart: { icon: VscFileCode, color: 'text-blue-500', label: 'Dart file' },
  scala: { icon: VscFileCode, color: 'text-red-600', label: 'Scala file' },
  sh: { icon: VscTerminal, color: 'text-gray-600', label: 'Shell script' },
  bash: { icon: VscTerminal, color: 'text-gray-600', label: 'Bash script' },
  zsh: { icon: VscTerminal, color: 'text-gray-600', label: 'ZSH script' },
  fish: { icon: VscTerminal, color: 'text-gray-600', label: 'Fish script' },
  ps1: { icon: VscTerminal, color: 'text-blue-600', label: 'PowerShell script' },
  bat: { icon: VscTerminal, color: 'text-gray-700', label: 'Batch file' },
  cmd: { icon: VscTerminal, color: 'text-gray-700', label: 'Command file' },

  // Database
  sql: { icon: SiPostgresql, color: 'text-blue-600', label: 'SQL file' },
  db: { icon: VscDatabase, color: 'text-gray-600', label: 'Database file' },
  sqlite: { icon: VscDatabase, color: 'text-blue-600', label: 'SQLite database' },
  sqlite3: { icon: VscDatabase, color: 'text-blue-600', label: 'SQLite database' },
  mongodb: { icon: SiMongodb, color: 'text-green-600', label: 'MongoDB file' },
  redis: { icon: SiRedis, color: 'text-red-600', label: 'Redis file' },

  // Documentation
  md: { icon: VscMarkdown, color: 'text-blue-600', label: 'Markdown file' },
  mdx: { icon: VscMarkdown, color: 'text-blue-700', label: 'MDX file' },
  rst: { icon: VscFileCode, color: 'text-gray-600', label: 'reStructuredText file' },
  txt: { icon: VscFile, color: 'text-gray-500', label: 'Text file' },
  pdf: { icon: VscFilePdf, color: 'text-red-600', label: 'PDF document' },
  doc: { icon: VscFileCode, color: 'text-blue-700', label: 'Word document' },
  docx: { icon: VscFileCode, color: 'text-blue-700', label: 'Word document' },
  xls: { icon: VscTable, color: 'text-green-700', label: 'Excel spreadsheet' },
  xlsx: { icon: VscTable, color: 'text-green-700', label: 'Excel spreadsheet' },
  csv: { icon: VscTable, color: 'text-green-600', label: 'CSV file' },

  // Images
  png: { icon: FaFileImage, color: 'text-purple-500', label: 'PNG image' },
  jpg: { icon: FaFileImage, color: 'text-purple-500', label: 'JPEG image' },
  jpeg: { icon: FaFileImage, color: 'text-purple-500', label: 'JPEG image' },
  gif: { icon: FaFileImage, color: 'text-purple-500', label: 'GIF image' },
  webp: { icon: FaFileImage, color: 'text-purple-500', label: 'WebP image' },
  svg: { icon: VscFileCode, color: 'text-orange-500', label: 'SVG image' },
  ico: { icon: FaFileImage, color: 'text-purple-400', label: 'Icon file' },
  bmp: { icon: FaFileImage, color: 'text-purple-400', label: 'Bitmap image' },
  tiff: { icon: FaFileImage, color: 'text-purple-400', label: 'TIFF image' },

  // Media
  mp3: { icon: VscFileMedia, color: 'text-purple-600', label: 'MP3 audio' },
  mp4: { icon: VscFileMedia, color: 'text-purple-600', label: 'MP4 video' },
  avi: { icon: VscFileMedia, color: 'text-purple-600', label: 'AVI video' },
  mov: { icon: VscFileMedia, color: 'text-purple-600', label: 'MOV video' },
  webm: { icon: VscFileMedia, color: 'text-purple-600', label: 'WebM video' },
  wav: { icon: VscFileMedia, color: 'text-purple-600', label: 'WAV audio' },
  flac: { icon: VscFileMedia, color: 'text-purple-600', label: 'FLAC audio' },
  ogg: { icon: VscFileMedia, color: 'text-purple-600', label: 'OGG audio' },

  // Archives
  zip: { icon: VscFileZip, color: 'text-gray-600', label: 'ZIP archive' },
  rar: { icon: VscFileZip, color: 'text-gray-600', label: 'RAR archive' },
  tar: { icon: VscFileZip, color: 'text-gray-600', label: 'TAR archive' },
  gz: { icon: VscFileZip, color: 'text-gray-600', label: 'GZIP archive' },
  '7z': { icon: VscFileZip, color: 'text-gray-600', label: '7-Zip archive' },
  bz2: { icon: VscFileZip, color: 'text-gray-600', label: 'BZIP2 archive' },
  xz: { icon: VscFileZip, color: 'text-gray-600', label: 'XZ archive' },

  // Security
  key: { icon: VscKey, color: 'text-yellow-600', label: 'Key file' },
  pem: { icon: VscKey, color: 'text-yellow-600', label: 'PEM certificate' },
  crt: { icon: VscKey, color: 'text-yellow-600', label: 'Certificate' },
  cer: { icon: VscKey, color: 'text-yellow-600', label: 'Certificate' },
  pub: { icon: VscKey, color: 'text-green-600', label: 'Public key' },
  lock: { icon: VscLock, color: 'text-red-600', label: 'Lock file' },

  // Binary
  exe: { icon: VscFileBinary, color: 'text-gray-700', label: 'Executable' },
  dll: { icon: VscFileBinary, color: 'text-gray-700', label: 'DLL file' },
  so: { icon: VscFileBinary, color: 'text-gray-700', label: 'Shared object' },
  dylib: { icon: VscFileBinary, color: 'text-gray-700', label: 'Dynamic library' },
  bin: { icon: VscFileBinary, color: 'text-gray-700', label: 'Binary file' },
  wasm: { icon: VscFileBinary, color: 'text-purple-600', label: 'WebAssembly' },

  // Misc
  log: { icon: VscFile, color: 'text-gray-600', label: 'Log file' },
  bak: { icon: VscFile, color: 'text-gray-500', label: 'Backup file' },
  tmp: { icon: VscFile, color: 'text-gray-500', label: 'Temporary file' },
  cache: { icon: VscFile, color: 'text-gray-500', label: 'Cache file' },
  test: { icon: VscSymbolMisc, color: 'text-green-600', label: 'Test file' },
  spec: { icon: VscSymbolMisc, color: 'text-green-600', label: 'Spec file' },
};

// Error boundary for icon failures
class IconErrorBoundary extends Component<
  { children: ReactNode; fallback?: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode; fallback?: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('Icon loading error:', error, errorInfo);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <VscError className="h-4 w-4 text-red-500" aria-label="Icon load error" />
        )
      );
    }
    return this.props.children;
  }
}

interface FileIconProps {
  filename: string;
  isDirectory: boolean;
  isExpanded?: boolean;
  className?: string;
  size?: number;
  isLoading?: boolean;
}

// Memoized icon component for performance
export const FileIcon = memo<FileIconProps>(
  ({ filename, isDirectory, isExpanded = false, className = '', size = 16, isLoading = false }) => {
    // Loading state
    if (isLoading) {
      return (
        <div
          className={`${className} animate-pulse rounded bg-gray-300 dark:bg-gray-600`}
          style={{ width: size, height: size }}
          role="img"
          aria-label="Loading file icon"
        />
      );
    }

    const iconProps = {
      className: `${className}`,
      size,
      style: { flexShrink: 0 },
      role: 'img' as const,
    };

    // Handle directories
    if (isDirectory) {
      const label = isExpanded ? 'Expanded folder' : 'Folder';
      const Icon = isExpanded ? VscFolderOpened : VscFolder;
      return (
        <IconErrorBoundary>
          <Icon
            {...iconProps}
            className={`${className} text-blue-500/80`}
            aria-label={label}
            title={label}
          />
        </IconErrorBoundary>
      );
    }

    const name = filename.toLowerCase();
    const ext = filename.split('.').pop()?.toLowerCase();

    // Get icon configuration
    let iconConfig = SPECIAL_FILES[name];

    // Check for special file patterns
    if (!iconConfig) {
      if (name.startsWith('dockerfile')) {
        iconConfig = { icon: SiDocker, color: 'text-blue-500', label: 'Docker file' };
      } else if (name.startsWith('.env')) {
        iconConfig = { icon: VscSettingsGear, color: 'text-yellow-600', label: 'Environment file' };
      } else if (ext && EXTENSION_ICONS[ext]) {
        iconConfig = EXTENSION_ICONS[ext];
      } else if (name.includes('.test.') || name.includes('.spec.')) {
        iconConfig = { icon: VscSymbolMisc, color: 'text-green-600', label: 'Test file' };
      } else if (name.includes('.stories.')) {
        iconConfig = { icon: SiStorybook, color: 'text-pink-600', label: 'Storybook file' };
      } else {
        // Default fallback
        iconConfig = { icon: VscFile, color: 'text-gray-500', label: 'File' };
      }
    }

    const { icon: IconComponent, color, label } = iconConfig;
    const ariaLabel = `${label}: ${filename}`;

    return (
      <IconErrorBoundary
        fallback={
          <VscFile {...iconProps} className={`${className} text-gray-500`} aria-label={ariaLabel} />
        }
      >
        <IconComponent
          {...iconProps}
          className={`${className} ${color}`}
          aria-label={ariaLabel}
          title={ariaLabel}
        />
      </IconErrorBoundary>
    );
  }
);

FileIcon.displayName = 'FileIcon';

export default FileIcon;
