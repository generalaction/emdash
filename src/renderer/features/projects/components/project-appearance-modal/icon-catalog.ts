import {
  Beaker,
  Bot,
  Box,
  Briefcase,
  Cloud,
  Code,
  Cpu,
  Database,
  Flame,
  FolderClosed,
  FolderInput,
  GitBranch,
  Github,
  Globe,
  Hammer,
  Heart,
  Layers,
  Library,
  Package,
  Palette,
  Rocket,
  Server,
  Sparkles,
  Star,
  Terminal,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react';

export const PROJECT_ICON_CATALOG: Record<string, LucideIcon | undefined> = {
  'folder-closed': FolderClosed,
  'folder-input': FolderInput,
  code: Code,
  terminal: Terminal,
  database: Database,
  layers: Layers,
  box: Box,
  cpu: Cpu,
  globe: Globe,
  github: Github,
  server: Server,
  cloud: Cloud,
  briefcase: Briefcase,
  rocket: Rocket,
  star: Star,
  heart: Heart,
  zap: Zap,
  sparkles: Sparkles,
  flame: Flame,
  hammer: Hammer,
  wrench: Wrench,
  package: Package,
  'git-branch': GitBranch,
  library: Library,
  bot: Bot,
  beaker: Beaker,
  palette: Palette,
};

export const PROJECT_ICON_NAMES = Object.keys(PROJECT_ICON_CATALOG);

export type ProjectColor = {
  id: string;
  label: string;
  className: string;
};

export const PROJECT_COLORS: ProjectColor[] = [
  { id: 'default', label: 'Default', className: 'text-foreground' },
  { id: 'red', label: 'Red', className: 'text-red-500' },
  { id: 'orange', label: 'Orange', className: 'text-orange-500' },
  { id: 'amber', label: 'Amber', className: 'text-amber-500' },
  { id: 'yellow', label: 'Yellow', className: 'text-yellow-500' },
  { id: 'lime', label: 'Lime', className: 'text-lime-500' },
  { id: 'green', label: 'Green', className: 'text-green-500' },
  { id: 'emerald', label: 'Emerald', className: 'text-emerald-500' },
  { id: 'teal', label: 'Teal', className: 'text-teal-500' },
  { id: 'cyan', label: 'Cyan', className: 'text-cyan-500' },
  { id: 'sky', label: 'Sky', className: 'text-sky-500' },
  { id: 'blue', label: 'Blue', className: 'text-blue-500' },
  { id: 'indigo', label: 'Indigo', className: 'text-indigo-500' },
  { id: 'violet', label: 'Violet', className: 'text-violet-500' },
  { id: 'purple', label: 'Purple', className: 'text-purple-500' },
  { id: 'fuchsia', label: 'Fuchsia', className: 'text-fuchsia-500' },
  { id: 'pink', label: 'Pink', className: 'text-pink-500' },
  { id: 'rose', label: 'Rose', className: 'text-rose-500' },
];

export function projectIconColorClass(colorId: string | null | undefined): string {
  if (!colorId) return 'text-foreground';
  return PROJECT_COLORS.find((c) => c.id === colorId)?.className ?? 'text-foreground';
}

/**
 * Project icon value format:
 *   - `lucide:<name>` — render Lucide icon, color applies
 *   - bare `<name>` matching catalog — legacy, treated as `lucide:<name>`
 *   - anything else — render as text (emoji)
 *   - null — default folder icon
 */
export type ParsedProjectIcon =
  | { kind: 'lucide'; name: string; component: LucideIcon }
  | { kind: 'emoji'; char: string }
  | { kind: 'none' };

export function parseProjectIcon(value: string | null | undefined): ParsedProjectIcon {
  if (!value) return { kind: 'none' };
  if (value.startsWith('lucide:')) {
    const name = value.slice('lucide:'.length);
    const component = PROJECT_ICON_CATALOG[name];
    if (component) return { kind: 'lucide', name, component };
    return { kind: 'none' };
  }
  // Bare lucide name (legacy compat)
  const component = PROJECT_ICON_CATALOG[value];
  if (component) return { kind: 'lucide', name: value, component };
  // Treat anything else as emoji
  return { kind: 'emoji', char: value };
}

export function lucideIconValue(name: string): string {
  return `lucide:${name}`;
}

/** @deprecated Use parseProjectIcon. Kept for transitional callers. */
export function getProjectIcon(iconName: string | null | undefined): LucideIcon | null {
  const parsed = parseProjectIcon(iconName);
  return parsed.kind === 'lucide' ? parsed.component : null;
}
