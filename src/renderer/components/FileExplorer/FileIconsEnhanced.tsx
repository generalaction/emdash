import React from 'react';
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

interface FileIconProps {
  filename: string;
  isDirectory: boolean;
  isExpanded?: boolean;
  className?: string;
  size?: number;
}

export const FileIcon: React.FC<FileIconProps> = ({
  filename,
  isDirectory,
  isExpanded = false,
  className = '',
  size = 16,
}) => {
  const iconProps = {
    className: `${className}`,
    size,
    style: { flexShrink: 0 },
  };

  // Handle directories
  if (isDirectory) {
    return isExpanded ? (
      <VscFolderOpened {...iconProps} className={`${className} text-blue-500/80`} />
    ) : (
      <VscFolder {...iconProps} className={`${className} text-blue-500/80`} />
    );
  }

  const name = filename.toLowerCase();
  const ext = filename.split('.').pop()?.toLowerCase();

  // Special file names (highest priority)
  const specialFiles: Record<string, React.ReactElement> = {
    'package.json': <SiNpm {...iconProps} className={`${className} text-red-500`} />,
    'package-lock.json': <SiNpm {...iconProps} className={`${className} text-red-400`} />,
    'yarn.lock': <SiYarn {...iconProps} className={`${className} text-blue-400`} />,
    'pnpm-lock.yaml': <SiNpm {...iconProps} className={`${className} text-orange-500`} />,
    '.gitignore': <SiGit {...iconProps} className={`${className} text-orange-600`} />,
    '.gitattributes': <SiGit {...iconProps} className={`${className} text-orange-600`} />,
    '.gitmodules': <SiGit {...iconProps} className={`${className} text-orange-600`} />,
    dockerfile: <SiDocker {...iconProps} className={`${className} text-blue-500`} />,
    'docker-compose.yml': <SiDocker {...iconProps} className={`${className} text-blue-500`} />,
    'docker-compose.yaml': <SiDocker {...iconProps} className={`${className} text-blue-500`} />,
    '.dockerignore': <SiDocker {...iconProps} className={`${className} text-blue-400`} />,
    '.env': <VscSettingsGear {...iconProps} className={`${className} text-yellow-600`} />,
    '.env.local': <VscSettingsGear {...iconProps} className={`${className} text-yellow-600`} />,
    '.env.production': (
      <VscSettingsGear {...iconProps} className={`${className} text-yellow-600`} />
    ),
    '.env.development': (
      <VscSettingsGear {...iconProps} className={`${className} text-yellow-600`} />
    ),
    '.eslintrc': <SiEslint {...iconProps} className={`${className} text-purple-600`} />,
    '.eslintrc.js': <SiEslint {...iconProps} className={`${className} text-purple-600`} />,
    '.eslintrc.json': <SiEslint {...iconProps} className={`${className} text-purple-600`} />,
    '.prettierrc': <SiPrettier {...iconProps} className={`${className} text-pink-500`} />,
    '.prettierrc.js': <SiPrettier {...iconProps} className={`${className} text-pink-500`} />,
    '.prettierrc.json': <SiPrettier {...iconProps} className={`${className} text-pink-500`} />,
    'vite.config.js': <SiVite {...iconProps} className={`${className} text-purple-500`} />,
    'vite.config.ts': <SiVite {...iconProps} className={`${className} text-purple-500`} />,
    'webpack.config.js': <SiWebpack {...iconProps} className={`${className} text-blue-600`} />,
    'rollup.config.js': <VscFileCode {...iconProps} className={`${className} text-red-600`} />,
    'babel.config.js': <SiBabel {...iconProps} className={`${className} text-yellow-500`} />,
    '.babelrc': <SiBabel {...iconProps} className={`${className} text-yellow-500`} />,
    'jest.config.js': <SiJest {...iconProps} className={`${className} text-red-600`} />,
    'cypress.config.js': <SiCypress {...iconProps} className={`${className} text-green-600`} />,
    'tailwind.config.js': <SiTailwindcss {...iconProps} className={`${className} text-cyan-500`} />,
    'postcss.config.js': <VscFileCode {...iconProps} className={`${className} text-orange-600`} />,
    'next.config.js': (
      <SiNextdotjs {...iconProps} className={`${className} text-gray-800 dark:text-white`} />
    ),
    'nuxt.config.js': <VscFileCode {...iconProps} className={`${className} text-green-600`} />,
    'angular.json': <SiAngular {...iconProps} className={`${className} text-red-600`} />,
    'readme.md': <VscMarkdown {...iconProps} className={`${className} text-blue-600`} />,
    license: <VscLock {...iconProps} className={`${className} text-yellow-600`} />,
    'license.md': <VscLock {...iconProps} className={`${className} text-yellow-600`} />,
    makefile: <VscSettingsGear {...iconProps} className={`${className} text-orange-600`} />,
  };

  // Check special files first
  if (specialFiles[name]) {
    return specialFiles[name];
  }

  // Check for Dockerfile variations
  if (name.startsWith('dockerfile')) {
    return <SiDocker {...iconProps} className={`${className} text-blue-500`} />;
  }

  // Check for .env variations
  if (name.startsWith('.env')) {
    return <VscSettingsGear {...iconProps} className={`${className} text-yellow-600`} />;
  }

  // File extensions mapping
  const extensionIcons: Record<string, React.ReactElement> = {
    // JavaScript/TypeScript
    ts: <SiTypescript {...iconProps} className={`${className} text-blue-600`} />,
    tsx: <SiReact {...iconProps} className={`${className} text-cyan-500`} />,
    js: <SiJavascript {...iconProps} className={`${className} text-yellow-500`} />,
    jsx: <SiReact {...iconProps} className={`${className} text-cyan-500`} />,
    mjs: <SiJavascript {...iconProps} className={`${className} text-yellow-500`} />,
    cjs: <SiNodedotjs {...iconProps} className={`${className} text-green-600`} />,
    coffee: <DiCoffeescript {...iconProps} className={`${className} text-brown-600`} />,

    // Web
    html: <SiHtml5 {...iconProps} className={`${className} text-orange-600`} />,
    htm: <SiHtml5 {...iconProps} className={`${className} text-orange-600`} />,
    css: <SiCss3 {...iconProps} className={`${className} text-blue-600`} />,
    scss: <SiSass {...iconProps} className={`${className} text-pink-600`} />,
    sass: <SiSass {...iconProps} className={`${className} text-pink-600`} />,
    less: <VscFileCode {...iconProps} className={`${className} text-blue-800`} />,
    styl: <VscFileCode {...iconProps} className={`${className} text-green-600`} />,

    // Frameworks
    vue: <SiVuedotjs {...iconProps} className={`${className} text-green-600`} />,
    svelte: <SiSvelte {...iconProps} className={`${className} text-orange-600`} />,

    // Data
    json: <VscJson {...iconProps} className={`${className} text-yellow-600`} />,
    jsonc: <VscJson {...iconProps} className={`${className} text-yellow-600`} />,
    json5: <VscJson {...iconProps} className={`${className} text-yellow-600`} />,
    xml: <VscFileCode {...iconProps} className={`${className} text-orange-500`} />,
    yaml: <VscFileCode {...iconProps} className={`${className} text-red-600`} />,
    yml: <VscFileCode {...iconProps} className={`${className} text-red-600`} />,
    toml: <VscFileCode {...iconProps} className={`${className} text-gray-600`} />,
    ini: <VscSettingsGear {...iconProps} className={`${className} text-gray-600`} />,
    env: <VscSettingsGear {...iconProps} className={`${className} text-yellow-600`} />,
    graphql: <SiGraphql {...iconProps} className={`${className} text-pink-600`} />,
    gql: <SiGraphql {...iconProps} className={`${className} text-pink-600`} />,

    // Programming Languages
    py: <SiPython {...iconProps} className={`${className} text-blue-500`} />,
    pyc: <SiPython {...iconProps} className={`${className} text-blue-400`} />,
    pyw: <SiPython {...iconProps} className={`${className} text-blue-500`} />,
    pyx: <SiPython {...iconProps} className={`${className} text-blue-600`} />,
    pyi: <SiPython {...iconProps} className={`${className} text-yellow-600`} />,
    go: <SiGo {...iconProps} className={`${className} text-cyan-600`} />,
    rs: <SiRust {...iconProps} className={`${className} text-orange-700`} />,
    java: <VscFileCode {...iconProps} className={`${className} text-red-600`} />,
    class: <VscFileCode {...iconProps} className={`${className} text-red-500`} />,
    jar: <VscFileCode {...iconProps} className={`${className} text-red-700`} />,
    c: <VscFileCode {...iconProps} className={`${className} text-blue-800`} />,
    cpp: <SiCplusplus {...iconProps} className={`${className} text-blue-600`} />,
    cc: <SiCplusplus {...iconProps} className={`${className} text-blue-600`} />,
    cxx: <SiCplusplus {...iconProps} className={`${className} text-blue-600`} />,
    h: <VscFileCode {...iconProps} className={`${className} text-purple-600`} />,
    hpp: <SiCplusplus {...iconProps} className={`${className} text-purple-600`} />,
    php: <SiPhp {...iconProps} className={`${className} text-purple-600`} />,
    rb: <SiRuby {...iconProps} className={`${className} text-red-600`} />,
    swift: <SiSwift {...iconProps} className={`${className} text-orange-600`} />,
    kt: <SiKotlin {...iconProps} className={`${className} text-purple-600`} />,
    lua: <SiLua {...iconProps} className={`${className} text-blue-800`} />,
    r: <VscFileCode {...iconProps} className={`${className} text-blue-600`} />,
    dart: <VscFileCode {...iconProps} className={`${className} text-blue-500`} />,
    scala: <VscFileCode {...iconProps} className={`${className} text-red-600`} />,
    sh: <VscTerminal {...iconProps} className={`${className} text-gray-600`} />,
    bash: <VscTerminal {...iconProps} className={`${className} text-gray-600`} />,
    zsh: <VscTerminal {...iconProps} className={`${className} text-gray-600`} />,
    fish: <VscTerminal {...iconProps} className={`${className} text-gray-600`} />,
    ps1: <VscTerminal {...iconProps} className={`${className} text-blue-600`} />,
    bat: <VscTerminal {...iconProps} className={`${className} text-gray-700`} />,
    cmd: <VscTerminal {...iconProps} className={`${className} text-gray-700`} />,

    // Database
    sql: <SiPostgresql {...iconProps} className={`${className} text-blue-600`} />,
    db: <VscDatabase {...iconProps} className={`${className} text-gray-600`} />,
    sqlite: <VscDatabase {...iconProps} className={`${className} text-blue-600`} />,
    sqlite3: <VscDatabase {...iconProps} className={`${className} text-blue-600`} />,
    mongodb: <SiMongodb {...iconProps} className={`${className} text-green-600`} />,
    redis: <SiRedis {...iconProps} className={`${className} text-red-600`} />,

    // Documentation
    md: <VscMarkdown {...iconProps} className={`${className} text-blue-600`} />,
    mdx: <VscMarkdown {...iconProps} className={`${className} text-blue-700`} />,
    rst: <VscFileCode {...iconProps} className={`${className} text-gray-600`} />,
    txt: <VscFile {...iconProps} className={`${className} text-gray-500`} />,
    pdf: <VscFilePdf {...iconProps} className={`${className} text-red-600`} />,
    doc: <VscFileCode {...iconProps} className={`${className} text-blue-700`} />,
    docx: <VscFileCode {...iconProps} className={`${className} text-blue-700`} />,
    xls: <VscTable {...iconProps} className={`${className} text-green-700`} />,
    xlsx: <VscTable {...iconProps} className={`${className} text-green-700`} />,
    csv: <VscTable {...iconProps} className={`${className} text-green-600`} />,

    // Images
    png: <FaFileImage {...iconProps} className={`${className} text-purple-500`} />,
    jpg: <FaFileImage {...iconProps} className={`${className} text-purple-500`} />,
    jpeg: <FaFileImage {...iconProps} className={`${className} text-purple-500`} />,
    gif: <FaFileImage {...iconProps} className={`${className} text-purple-500`} />,
    webp: <FaFileImage {...iconProps} className={`${className} text-purple-500`} />,
    svg: <VscFileCode {...iconProps} className={`${className} text-orange-500`} />,
    ico: <FaFileImage {...iconProps} className={`${className} text-purple-400`} />,
    bmp: <FaFileImage {...iconProps} className={`${className} text-purple-400`} />,
    tiff: <FaFileImage {...iconProps} className={`${className} text-purple-400`} />,
    psd: <FaFileImage {...iconProps} className={`${className} text-blue-800`} />,
    ai: <FaFileImage {...iconProps} className={`${className} text-orange-600`} />,
    sketch: <FaFileImage {...iconProps} className={`${className} text-orange-500`} />,
    fig: <FaFileImage {...iconProps} className={`${className} text-purple-600`} />,

    // Media
    mp3: <VscFileMedia {...iconProps} className={`${className} text-purple-600`} />,
    mp4: <VscFileMedia {...iconProps} className={`${className} text-purple-600`} />,
    avi: <VscFileMedia {...iconProps} className={`${className} text-purple-600`} />,
    mov: <VscFileMedia {...iconProps} className={`${className} text-purple-600`} />,
    webm: <VscFileMedia {...iconProps} className={`${className} text-purple-600`} />,
    wav: <VscFileMedia {...iconProps} className={`${className} text-purple-600`} />,
    flac: <VscFileMedia {...iconProps} className={`${className} text-purple-600`} />,
    ogg: <VscFileMedia {...iconProps} className={`${className} text-purple-600`} />,

    // Archives
    zip: <VscFileZip {...iconProps} className={`${className} text-gray-600`} />,
    rar: <VscFileZip {...iconProps} className={`${className} text-gray-600`} />,
    tar: <VscFileZip {...iconProps} className={`${className} text-gray-600`} />,
    gz: <VscFileZip {...iconProps} className={`${className} text-gray-600`} />,
    '7z': <VscFileZip {...iconProps} className={`${className} text-gray-600`} />,
    bz2: <VscFileZip {...iconProps} className={`${className} text-gray-600`} />,
    xz: <VscFileZip {...iconProps} className={`${className} text-gray-600`} />,

    // Security
    key: <VscKey {...iconProps} className={`${className} text-yellow-600`} />,
    pem: <VscKey {...iconProps} className={`${className} text-yellow-600`} />,
    crt: <VscKey {...iconProps} className={`${className} text-yellow-600`} />,
    cer: <VscKey {...iconProps} className={`${className} text-yellow-600`} />,
    pub: <VscKey {...iconProps} className={`${className} text-green-600`} />,
    lock: <VscLock {...iconProps} className={`${className} text-red-600`} />,

    // Binary
    exe: <VscFileBinary {...iconProps} className={`${className} text-gray-700`} />,
    dll: <VscFileBinary {...iconProps} className={`${className} text-gray-700`} />,
    so: <VscFileBinary {...iconProps} className={`${className} text-gray-700`} />,
    dylib: <VscFileBinary {...iconProps} className={`${className} text-gray-700`} />,
    bin: <VscFileBinary {...iconProps} className={`${className} text-gray-700`} />,
    wasm: <VscFileBinary {...iconProps} className={`${className} text-purple-600`} />,

    // Misc
    log: <VscFile {...iconProps} className={`${className} text-gray-600`} />,
    bak: <VscFile {...iconProps} className={`${className} text-gray-500`} />,
    tmp: <VscFile {...iconProps} className={`${className} text-gray-500`} />,
    cache: <VscFile {...iconProps} className={`${className} text-gray-500`} />,
    test: <VscSymbolMisc {...iconProps} className={`${className} text-green-600`} />,
    spec: <VscSymbolMisc {...iconProps} className={`${className} text-green-600`} />,
  };

  // Check file extension
  if (ext && extensionIcons[ext]) {
    return extensionIcons[ext];
  }

  // Check for test/spec files
  if (name.includes('.test.') || name.includes('.spec.')) {
    return <VscSymbolMisc {...iconProps} className={`${className} text-green-600`} />;
  }

  // Check for stories (Storybook)
  if (name.includes('.stories.')) {
    return <SiStorybook {...iconProps} className={`${className} text-pink-600`} />;
  }

  // Default file icon
  return <VscFile {...iconProps} className={`${className} text-gray-500`} />;
};

export default FileIcon;
