import React from 'react';

// VS Code style file icons as SVG components
export const FileIconType = {
  // TypeScript icon (blue TS)
  TypeScript: () => (
    <svg viewBox="0 0 16 16" className="h-4 w-4 flex-shrink-0">
      <rect width="16" height="16" rx="2" fill="#3178c6" />
      <text
        x="50%"
        y="50%"
        dominantBaseline="middle"
        textAnchor="middle"
        fill="white"
        fontSize="10"
        fontWeight="bold"
      >
        TS
      </text>
    </svg>
  ),

  // React/TSX icon (cyan React logo)
  React: () => (
    <svg viewBox="0 0 16 16" className="h-4 w-4 flex-shrink-0">
      <rect width="16" height="16" rx="2" fill="#61dafb" />
      <circle cx="8" cy="8" r="1.5" fill="#282c34" />
      <ellipse cx="8" cy="8" rx="5" ry="2" fill="none" stroke="#282c34" strokeWidth="0.8" />
      <ellipse
        cx="8"
        cy="8"
        rx="5"
        ry="2"
        fill="none"
        stroke="#282c34"
        strokeWidth="0.8"
        transform="rotate(60 8 8)"
      />
      <ellipse
        cx="8"
        cy="8"
        rx="5"
        ry="2"
        fill="none"
        stroke="#282c34"
        strokeWidth="0.8"
        transform="rotate(-60 8 8)"
      />
    </svg>
  ),

  // JavaScript icon (yellow JS)
  JavaScript: () => (
    <svg viewBox="0 0 16 16" className="h-4 w-4 flex-shrink-0">
      <rect width="16" height="16" rx="2" fill="#f7df1e" />
      <text
        x="50%"
        y="50%"
        dominantBaseline="middle"
        textAnchor="middle"
        fill="#323330"
        fontSize="10"
        fontWeight="bold"
      >
        JS
      </text>
    </svg>
  ),

  // JSON icon
  JSON: () => (
    <svg viewBox="0 0 16 16" className="h-4 w-4 flex-shrink-0">
      <rect width="16" height="16" rx="2" fill="#292929" />
      <text
        x="50%"
        y="50%"
        dominantBaseline="middle"
        textAnchor="middle"
        fill="#fbc02d"
        fontSize="5"
        fontWeight="bold"
      >{`{}`}</text>
    </svg>
  ),

  // CSS icon
  CSS: () => (
    <svg viewBox="0 0 16 16" className="h-4 w-4 flex-shrink-0">
      <rect width="16" height="16" rx="2" fill="#1572b6" />
      <text
        x="50%"
        y="50%"
        dominantBaseline="middle"
        textAnchor="middle"
        fill="white"
        fontSize="7"
        fontWeight="bold"
      >
        CSS
      </text>
    </svg>
  ),

  // SCSS icon
  SCSS: () => (
    <svg viewBox="0 0 16 16" className="h-4 w-4 flex-shrink-0">
      <rect width="16" height="16" rx="2" fill="#cf649a" />
      <text
        x="50%"
        y="50%"
        dominantBaseline="middle"
        textAnchor="middle"
        fill="white"
        fontSize="6"
        fontWeight="bold"
      >
        SCSS
      </text>
    </svg>
  ),

  // HTML icon
  HTML: () => (
    <svg viewBox="0 0 16 16" className="h-4 w-4 flex-shrink-0">
      <rect width="16" height="16" rx="2" fill="#e34c26" />
      <text
        x="50%"
        y="50%"
        dominantBaseline="middle"
        textAnchor="middle"
        fill="white"
        fontSize="5"
        fontWeight="bold"
      >
        HTML
      </text>
    </svg>
  ),

  // Markdown icon
  Markdown: () => (
    <svg viewBox="0 0 16 16" className="h-4 w-4 flex-shrink-0">
      <rect width="16" height="16" rx="2" fill="#083fa1" />
      <text
        x="50%"
        y="50%"
        dominantBaseline="middle"
        textAnchor="middle"
        fill="white"
        fontSize="8"
        fontWeight="bold"
      >
        M↓
      </text>
    </svg>
  ),

  // Git icon
  Git: () => (
    <svg viewBox="0 0 16 16" className="h-4 w-4 flex-shrink-0">
      <rect width="16" height="16" rx="2" fill="#f05032" />
      <path
        d="M8 4L4 8l4 4M8 4l4 4-4 4"
        stroke="white"
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  ),

  // Package.json icon
  Package: () => (
    <svg viewBox="0 0 16 16" className="h-4 w-4 flex-shrink-0">
      <rect width="16" height="16" rx="2" fill="#68a063" />
      <rect x="4" y="4" width="8" height="8" fill="white" opacity="0.9" />
      <rect x="6" y="6" width="4" height="4" fill="#68a063" />
    </svg>
  ),

  // Python icon
  Python: () => (
    <svg viewBox="0 0 16 16" className="h-4 w-4 flex-shrink-0">
      <rect width="16" height="16" rx="2" fill="#3776ab" />
      <text
        x="50%"
        y="50%"
        dominantBaseline="middle"
        textAnchor="middle"
        fill="#ffd43b"
        fontSize="8"
        fontWeight="bold"
      >
        Py
      </text>
    </svg>
  ),

  // YAML icon
  YAML: () => (
    <svg viewBox="0 0 16 16" className="h-4 w-4 flex-shrink-0">
      <rect width="16" height="16" rx="2" fill="#cb171e" />
      <text
        x="50%"
        y="50%"
        dominantBaseline="middle"
        textAnchor="middle"
        fill="white"
        fontSize="6"
        fontWeight="bold"
      >
        YAML
      </text>
    </svg>
  ),

  // ENV icon
  ENV: () => (
    <svg viewBox="0 0 16 16" className="h-4 w-4 flex-shrink-0">
      <rect width="16" height="16" rx="2" fill="#fbc02d" />
      <text
        x="50%"
        y="50%"
        dominantBaseline="middle"
        textAnchor="middle"
        fill="#333"
        fontSize="6"
        fontWeight="bold"
      >
        .env
      </text>
    </svg>
  ),

  // Image icon
  Image: () => (
    <svg viewBox="0 0 16 16" className="h-4 w-4 flex-shrink-0">
      <rect width="16" height="16" rx="2" fill="#ac5fb0" />
      <rect x="3" y="4" width="10" height="8" rx="0.5" fill="white" />
      <circle cx="6" cy="7" r="1" fill="#ac5fb0" />
      <path d="M3 10l3-2 2 1 3-2 2 3" fill="#ac5fb0" />
    </svg>
  ),

  // Folder closed
  Folder: () => (
    <svg viewBox="0 0 16 16" className="h-4 w-4 flex-shrink-0">
      <path
        d="M2 4.5V12.5C2 13.05 2.45 13.5 3 13.5H13C13.55 13.5 14 13.05 14 12.5V6.5C14 5.95 13.55 5.5 13 5.5H8L6.5 3.5H3C2.45 3.5 2 3.95 2 4.5Z"
        fill="#8b92a0"
      />
    </svg>
  ),

  // Folder open
  FolderOpen: () => (
    <svg viewBox="0 0 16 16" className="h-4 w-4 flex-shrink-0">
      <path
        d="M2 4.5V12.5C2 13.05 2.45 13.5 3 13.5H13C13.55 13.5 14 13.05 14 12.5V6.5C14 5.95 13.55 5.5 13 5.5H8L6.5 3.5H3C2.45 3.5 2 3.95 2 4.5Z"
        fill="#8b92a0"
      />
      <path d="M3 7H13L11.5 12.5H4.5L3 7Z" fill="#8b92a0" opacity="0.8" />
    </svg>
  ),

  // Default file icon
  File: () => (
    <svg viewBox="0 0 16 16" className="h-4 w-4 flex-shrink-0">
      <path
        d="M10 2H4C3.45 2 3 2.45 3 3V13C3 13.55 3.45 14 4 14H12C12.55 14 13 13.55 13 13V5L10 2Z"
        fill="#9ca3af"
      />
      <path d="M10 2V5H13" fill="#d1d5db" />
    </svg>
  ),

  // Docker icon
  Docker: () => (
    <svg viewBox="0 0 16 16" className="h-4 w-4 flex-shrink-0">
      <rect width="16" height="16" rx="2" fill="#0db7ed" />
      <g fill="white">
        <rect x="3" y="5" width="2" height="2" />
        <rect x="5.5" y="5" width="2" height="2" />
        <rect x="8" y="5" width="2" height="2" />
        <rect x="5.5" y="7.5" width="2" height="2" />
        <rect x="8" y="7.5" width="2" height="2" />
        <rect x="10.5" y="7.5" width="2" height="2" />
      </g>
    </svg>
  ),

  // Shell/Terminal icon
  Shell: () => (
    <svg viewBox="0 0 16 16" className="h-4 w-4 flex-shrink-0">
      <rect width="16" height="16" rx="2" fill="#2d2d2d" />
      <text x="3" y="10" fill="#4ec9b0" fontSize="8" fontFamily="monospace">
        $_
      </text>
    </svg>
  ),

  // Vue icon
  Vue: () => (
    <svg viewBox="0 0 16 16" className="h-4 w-4 flex-shrink-0">
      <path d="M2 3L8 13L14 3H11L8 8L5 3H2Z" fill="#4fc08d" />
      <path d="M5 3L8 8L11 3H9L8 5L7 3H5Z" fill="#35495e" />
    </svg>
  ),
};

// Function to render the appropriate icon for a file
export const FileIcon = ({
  filename,
  isDirectory,
  isExpanded = false,
}: {
  filename: string;
  isDirectory: boolean;
  isExpanded?: boolean;
}) => {
  if (isDirectory) {
    return isExpanded ? <FileIconType.FolderOpen /> : <FileIconType.Folder />;
  }

  const ext = filename.split('.').pop()?.toLowerCase();
  const name = filename.toLowerCase();

  // Special files
  if (name === 'package.json') return <FileIconType.Package />;
  if (name === '.gitignore' || name === '.gitattributes') return <FileIconType.Git />;
  if (name === 'dockerfile' || name.startsWith('dockerfile.')) return <FileIconType.Docker />;
  if (name === '.env' || name.startsWith('.env.')) return <FileIconType.ENV />;

  // By extension
  switch (ext) {
    case 'ts':
    case 'mts':
    case 'cts':
      return <FileIconType.TypeScript />;
    case 'tsx':
      return <FileIconType.React />;
    case 'jsx':
      return <FileIconType.React />;
    case 'js':
    case 'mjs':
    case 'cjs':
      return <FileIconType.JavaScript />;
    case 'json':
    case 'jsonc':
    case 'json5':
      return <FileIconType.JSON />;
    case 'css':
      return <FileIconType.CSS />;
    case 'scss':
    case 'sass':
      return <FileIconType.SCSS />;
    case 'html':
    case 'htm':
      return <FileIconType.HTML />;
    case 'md':
    case 'mdx':
    case 'markdown':
      return <FileIconType.Markdown />;
    case 'yml':
    case 'yaml':
      return <FileIconType.YAML />;
    case 'py':
    case 'pyw':
      return <FileIconType.Python />;
    case 'vue':
      return <FileIconType.Vue />;
    case 'sh':
    case 'bash':
    case 'zsh':
    case 'fish':
    case 'ps1':
    case 'bat':
    case 'cmd':
      return <FileIconType.Shell />;
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
    case 'svg':
    case 'ico':
    case 'bmp':
      return <FileIconType.Image />;
    default:
      return <FileIconType.File />;
  }
};
