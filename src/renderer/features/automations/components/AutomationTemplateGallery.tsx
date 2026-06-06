import {
  Accessibility,
  BookOpen,
  Bug,
  CalendarDays,
  Eraser,
  FileText,
  Flag,
  FlaskConical,
  Gauge,
  KeyRound,
  ListTodo,
  type LucideIcon,
  Mail,
  PackageOpen,
  Repeat,
  Rocket,
  ScrollText,
  Search,
  ShieldCheck,
  Wrench,
} from 'lucide-react';
import { useState } from 'react';
import { CardGrid, CardGridItem } from '@renderer/lib/components/card-grid';
import { MicroLabel } from '@renderer/lib/ui/label';
import { PanelTabs } from '@renderer/lib/ui/panel-tabs';
import type { BuiltinAutomationTemplate } from '@shared/automations/automation';
import {
  automationCatalogCategories,
  builtinAutomationTemplatesByCategory,
  popularAutomationTemplates,
  type AutomationCatalogCategory,
  type AutomationTemplateIcon,
  type CatalogTemplate,
} from '@shared/automations/builtin-catalog';

const templateIcons: Record<AutomationTemplateIcon, LucideIcon> = {
  Accessibility,
  BookOpen,
  Bug,
  CalendarDays,
  Eraser,
  FileText,
  Flag,
  FlaskConical,
  Gauge,
  KeyRound,
  ListTodo,
  Mail,
  PackageOpen,
  Repeat,
  Rocket,
  ScrollText,
  Search,
  ShieldCheck,
  Wrench,
};

const POPULAR_TAB = 'Popular';
type GalleryTab = typeof POPULAR_TAB | AutomationCatalogCategory;

const galleryTabValues: GalleryTab[] = [POPULAR_TAB, ...automationCatalogCategories];
const galleryTabs = galleryTabValues.map((category) => ({
  value: category,
  label: category,
}));

interface AutomationTemplateGalleryProps {
  onSelectTemplate: (template: BuiltinAutomationTemplate) => void;
}

export function AutomationTemplateGallery({ onSelectTemplate }: AutomationTemplateGalleryProps) {
  const [activeTab, setActiveTab] = useState<GalleryTab>(POPULAR_TAB);
  const templates =
    activeTab === POPULAR_TAB
      ? popularAutomationTemplates
      : builtinAutomationTemplatesByCategory[activeTab];

  return (
    <div className="flex flex-col gap-2.5">
      <MicroLabel>Templates</MicroLabel>
      <PanelTabs compact value={activeTab} onChange={setActiveTab} tabs={galleryTabs} />
      <CardGrid className="sm:grid-cols-2">
        {templates.map((template) => (
          <AutomationTemplateCard
            key={template.id}
            template={template}
            onSelect={onSelectTemplate}
          />
        ))}
      </CardGrid>
    </div>
  );
}

interface AutomationTemplateCardProps {
  template: CatalogTemplate;
  onSelect: (template: BuiltinAutomationTemplate) => void;
}

function AutomationTemplateCard({ template, onSelect }: AutomationTemplateCardProps) {
  const Icon = templateIcons[template.icon];
  return (
    <CardGridItem
      role="button"
      tabIndex={0}
      onClick={() => onSelect(template)}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onSelect(template);
      }}
      className="h-full flex-col items-start gap-1.5 p-3 outline-none"
    >
      <div className="flex w-full min-w-0 items-center gap-2">
        <Icon className="size-3.5 shrink-0 text-foreground-muted" aria-hidden="true" />
        <h3
          className="line-clamp-1 min-w-0 text-sm leading-5 font-medium text-foreground"
          title={template.name}
        >
          {template.name}
        </h3>
      </div>
      <p className="line-clamp-2 text-xs leading-relaxed text-foreground-muted">
        {template.description}
      </p>
    </CardGridItem>
  );
}
