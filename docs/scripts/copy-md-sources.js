/**
 * Copies MDX documentation files to public/md-src as .md files
 * for serving via the Copy Markdown feature.
 *
 * Run: node scripts/copy-md-sources.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SOURCE_DIR = path.join(__dirname, '../content/docs');
const OUTPUT_DIR = path.join(__dirname, '../public/md-src');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function cleanDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true });
  }
  fs.mkdirSync(dir, { recursive: true });
}

function getAllMdxFiles(dir, files = [], baseDir = dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      getAllMdxFiles(fullPath, files, baseDir);
    } else if (entry.name.endsWith('.mdx') || entry.name.endsWith('.md')) {
      const relativePath = path.relative(baseDir, fullPath);
      files.push({ fullPath, relativePath });
    }
  }

  return files;
}

function stripFrontmatter(content) {
  // Remove YAML frontmatter (---...---) but keep the title/description as header
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return content;

  const frontmatter = match[1];
  const body = match[2];

  // Extract title and description from frontmatter
  const titleMatch = frontmatter.match(/^title:\s*(.+)$/m);
  const descMatch = frontmatter.match(/^description:\s*(.+)$/m);

  const title = titleMatch ? titleMatch[1].replace(/^["']|["']$/g, '') : null;
  const desc = descMatch ? descMatch[1].replace(/^["']|["']$/g, '') : null;

  // Build header
  let header = '';
  if (title) {
    header += `# ${title}\n\n`;
  }
  if (desc) {
    header += `${desc}\n\n`;
  }

  return header + body.trim();
}

function processContent(content) {
  // Strip frontmatter and convert to clean markdown
  let processed = stripFrontmatter(content);

  // Remove JSX import statements
  processed = processed.replace(/^import\s+.*?from\s+['"].*?['"];?\s*$/gm, '');

  // Remove empty lines at the start
  processed = processed.replace(/^\n+/, '');

  return processed;
}

function main() {
  console.log('Copying MDX sources to public/md-src...');

  cleanDir(OUTPUT_DIR);

  const files = getAllMdxFiles(SOURCE_DIR);
  let count = 0;

  for (const { fullPath, relativePath } of files) {
    // Convert path: foo/bar.mdx -> foo/bar.md, index.mdx -> index.md
    let outputRelative = relativePath.replace(/\.mdx$/, '.md');

    // Handle index files: docs/index.md -> docs.md (for cleaner URLs)
    if (outputRelative.endsWith('/index.md')) {
      outputRelative = outputRelative.replace('/index.md', '.md');
    } else if (outputRelative === 'index.md') {
      // Root index stays as index.md
      outputRelative = 'index.md';
    }

    const outputPath = path.join(OUTPUT_DIR, outputRelative);

    ensureDir(path.dirname(outputPath));

    const content = fs.readFileSync(fullPath, 'utf-8');
    const processed = processContent(content);

    fs.writeFileSync(outputPath, processed);
    count++;
  }

  console.log(`Copied ${count} files to public/md-src`);
}

main();
