/**
 * Map file extensions to Monaco Editor language IDs
 * Monaco uses different IDs than Prism in some cases
 */
export function getMonacoLanguageId(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const langMap: Record<string, string> = {
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    py: 'python',
    java: 'java',
    c: 'c',
    cpp: 'cpp',
    cc: 'cpp',
    h: 'c',
    hpp: 'cpp',
    cs: 'csharp',
    go: 'go',
    rs: 'rust',
    rb: 'ruby',
    php: 'php',
    swift: 'swift',
    kt: 'kotlin',
    scala: 'scala',
    sh: 'shell',
    bash: 'shell',
    zsh: 'shell',
    fish: 'shell',
    yml: 'yaml',
    yaml: 'yaml',
    json: 'json',
    jsonc: 'jsonc',
    xml: 'xml',
    html: 'html',
    css: 'css',
    scss: 'scss',
    sass: 'scss',
    less: 'less',
    sql: 'sql',
    md: 'markdown',
    markdown: 'markdown',
    vue: 'vue',
    svelte: 'svelte',
    dart: 'dart',
    lua: 'lua',
    perl: 'perl',
    r: 'r',
    matlab: 'matlab',
    dockerfile: 'dockerfile',
    makefile: 'makefile',
    toml: 'toml',
    ini: 'ini',
    properties: 'properties',
    log: 'plaintext',
    txt: 'plaintext',
  };

  // Check for special file names
  if (filePath.toLowerCase().includes('dockerfile')) return 'dockerfile';
  if (filePath.toLowerCase().includes('makefile')) return 'makefile';

  return langMap[ext] || 'plaintext';
}

/**
 * Check if a file is likely binary based on extension
 */
export function isBinaryFile(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const binaryExtensions = [
    'png',
    'jpg',
    'jpeg',
    'gif',
    'svg',
    'ico',
    'webp',
    'pdf',
    'zip',
    'tar',
    'gz',
    'bz2',
    'xz',
    '7z',
    'exe',
    'dll',
    'so',
    'dylib',
    'bin',
    'woff',
    'woff2',
    'ttf',
    'otf',
    'eot',
    'mp3',
    'mp4',
    'avi',
    'mov',
    'wmv',
    'flv',
    'webm',
    'ogg',
  ];
  return binaryExtensions.includes(ext);
}
