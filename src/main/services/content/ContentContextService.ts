import { brandService } from './BrandService';
import { knowledgeService } from './KnowledgeService';
import { collectionService } from './CollectionService';
import { contentWorkspaceService } from './ContentWorkspaceService';
import { log } from '../../lib/logger';

export interface ContentContext {
  /** Formatted context ready for agent injection */
  context: string;
  /** Estimated character count */
  characterCount: number;
  /** Whether brand guidelines were included */
  hasBrand: boolean;
  /** Whether knowledge documents were included */
  hasKnowledge: boolean;
  /** Number of knowledge documents included */
  documentCount: number;
}

export interface ContentContextOptions {
  /** Include content brief in context */
  includeBrief?: boolean;
  /** Content brief data */
  brief?: {
    topic?: string;
    audience?: string;
    keywords?: string;
    tone?: string;
    notes?: string;
  };
  /** Optional prompt template to wrap the context */
  template?: string;
}

/**
 * Service for composing content context from brand guidelines and knowledge documents.
 * This context is injected into agent prompts for content-aware generation.
 */
export class ContentContextService {
  /**
   * Get full content context for a task based on its collection.
   * Loads workspace brand guidelines and collection knowledge documents.
   */
  async getContextForTask(
    collectionId: string | null | undefined,
    options: ContentContextOptions = {}
  ): Promise<ContentContext> {
    let brandContext = '';
    let knowledgeContext = '';
    let hasBrand = false;
    let hasKnowledge = false;
    let documentCount = 0;

    if (collectionId) {
      // Get the collection to find the workspace
      const collection = await collectionService.getById(collectionId);

      if (collection) {
        // Get workspace brand guidelines
        const workspace = await contentWorkspaceService.getById(collection.workspaceId);
        if (workspace) {
          const activeBrand = await brandService.getActive(workspace.id);
          if (activeBrand) {
            brandContext = brandService.formatForAgent(activeBrand);
            hasBrand = true;
          }
        }

        // Get knowledge documents from collection
        const documents = await knowledgeService.getByCollectionId(collectionId);
        if (documents.length > 0) {
          knowledgeContext = knowledgeService.formatCollectionForAgent(documents);
          hasKnowledge = true;
          documentCount = documents.length;
        }
      }
    }

    // Build the context sections
    const sections: string[] = [];

    // Add brand guidelines
    if (brandContext) {
      sections.push(brandContext);
    }

    // Add content brief if provided
    if (options.includeBrief && options.brief) {
      const briefContext = this.formatBriefForAgent(options.brief);
      if (briefContext) {
        sections.push(briefContext);
      }
    }

    // Add knowledge documents
    if (knowledgeContext) {
      sections.push(knowledgeContext);
    }

    // Combine sections
    let context = sections.join('\n\n');

    // Wrap with template if provided
    if (options.template && context) {
      context = options.template.replace('{{content_context}}', context);
    }

    return {
      context,
      characterCount: context.length,
      hasBrand,
      hasKnowledge,
      documentCount,
    };
  }

  /**
   * Get context for a workspace (brand only, no collection-specific knowledge).
   */
  async getWorkspaceContext(workspaceId: string): Promise<ContentContext> {
    let brandContext = '';
    let hasBrand = false;

    const activeBrand = await brandService.getActive(workspaceId);
    if (activeBrand) {
      brandContext = brandService.formatForAgent(activeBrand);
      hasBrand = true;
    }

    return {
      context: brandContext,
      characterCount: brandContext.length,
      hasBrand,
      hasKnowledge: false,
      documentCount: 0,
    };
  }

  /**
   * Format content brief for agent context injection.
   */
  formatBriefForAgent(brief: ContentContextOptions['brief']): string {
    if (!brief) return '';

    const lines: string[] = ['<content_brief>'];

    if (brief.topic) {
      lines.push(`<topic>${brief.topic}</topic>`);
    }
    if (brief.audience) {
      lines.push(`<target_audience>${brief.audience}</target_audience>`);
    }
    if (brief.keywords) {
      lines.push(`<keywords>${brief.keywords}</keywords>`);
    }
    if (brief.tone) {
      lines.push(`<tone_style>${brief.tone}</tone_style>`);
    }
    if (brief.notes) {
      lines.push(`<additional_notes>${brief.notes}</additional_notes>`);
    }

    lines.push('</content_brief>');

    // Only return if we have at least one field
    if (lines.length <= 2) return '';

    return lines.join('\n');
  }

  /**
   * Estimate token count (rough approximation: ~4 chars per token).
   */
  estimateTokenCount(context: string): number {
    return Math.ceil(context.length / 4);
  }

  /**
   * Create a system prompt preamble for content creation.
   */
  createContentPreamble(options: {
    hasBrand: boolean;
    hasKnowledge: boolean;
    role?: string;
  }): string {
    const lines: string[] = ['You are assisting with content creation.', ''];

    if (options.role) {
      lines[0] = `You are a ${options.role} assisting with content creation.`;
    }

    if (options.hasBrand) {
      lines.push(
        'The following brand guidelines define the voice, tone, and style to use.',
        'Ensure all content adheres to these guidelines.',
        ''
      );
    }

    if (options.hasKnowledge) {
      lines.push(
        'Knowledge documents are provided as reference material.',
        'Use these documents to inform your content with accurate, relevant information.',
        ''
      );
    }

    return lines.join('\n');
  }

  /**
   * Compose full prompt with preamble, context, and user instructions.
   */
  composeFullPrompt(options: {
    context: ContentContext;
    userPrompt?: string;
    role?: string;
  }): string {
    const { context, userPrompt, role } = options;

    const parts: string[] = [];

    // Add preamble
    const preamble = this.createContentPreamble({
      hasBrand: context.hasBrand,
      hasKnowledge: context.hasKnowledge,
      role,
    });
    if (preamble) {
      parts.push(preamble);
    }

    // Add context
    if (context.context) {
      parts.push(context.context);
    }

    // Add user prompt
    if (userPrompt?.trim()) {
      parts.push('---', '', userPrompt.trim());
    }

    return parts.join('\n');
  }
}

export const contentContextService = new ContentContextService();
