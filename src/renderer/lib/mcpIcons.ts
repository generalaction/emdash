// SVG icons (imported as raw strings for inline rendering)
import playwrightSvg from '../../assets/images/mcp/playwright.svg?raw';
import supabaseSvg from '../../assets/images/mcp/supabase.svg?raw';
import vercelSvg from '../../assets/images/mcp/vercel.svg?raw';
import sentrySvg from '../../assets/images/mcp/sentry.svg?raw';
import stripeSvg from '../../assets/images/mcp/stripe.svg?raw';
import figmaSvg from '../../assets/images/mcp/figma.svg?raw';
import linearSvg from '../../assets/images/mcp/linear.svg?raw';
import slackSvg from '../../assets/images/mcp/slack.svg?raw';
import cloudflareSvg from '../../assets/images/mcp/cloudflare.svg?raw';
import netlifySvg from '../../assets/images/mcp/netlify.svg?raw';
import chromeDevtoolsSvg from '../../assets/images/mcp/chrome_devtools.svg?raw';
import atlassianSvg from '../../assets/images/mcp/atlassian.svg?raw';
import notionSvg from '../../assets/images/mcp/notion.svg?raw';
import clerkSvg from '../../assets/images/mcp/clerk.svg?raw';
import planetscaleSvg from '../../assets/images/mcp/planetscale.svg?raw';
import huggingFaceSvg from '../../assets/images/mcp/hugging_face.svg?raw';
import posthogSvg from '../../assets/images/mcp/posthog.svg?raw';
import graphosSvg from '../../assets/images/mcp/graphos.svg?raw';
import sanitySvg from '../../assets/images/mcp/sanity.svg?raw';
import asanaSvg from '../../assets/images/mcp/asana.svg?raw';
import clickupSvg from '../../assets/images/mcp/clickup.svg?raw';
import webflowSvg from '../../assets/images/mcp/webflow.svg?raw';
import cloudinarySvg from '../../assets/images/mcp/cloudinary.svg?raw';
import wordpressSvg from '../../assets/images/mcp/wordpress.svg?raw';
import miroSvg from '../../assets/images/mcp/miro.svg?raw';
import intercomSvg from '../../assets/images/mcp/intercom.svg?raw';
import wixSvg from '../../assets/images/mcp/wix.svg?raw';
import makeSvg from '../../assets/images/mcp/make.svg?raw';
import bigquerySvg from '../../assets/images/mcp/bigquery.svg?raw';
import awsMarketplaceSvg from '../../assets/images/mcp/aws_marketplace.svg?raw';
import microsoftLearnSvg from '../../assets/images/mcp/microsoft_learn.svg?raw';
import canvaSvg from '../../assets/images/mcp/canva.svg?raw';
import devrevSvg from '../../assets/images/mcp/devrev.svg?raw';
import context7Svg from '../../assets/images/Context7.svg?raw';
import excalidrawSvg from '../../assets/images/mcp/excalidraw.svg?raw';
import githubSvg from '../../assets/images/mcp/github.svg?raw';
import stitchSvg from '../../assets/images/mcp/stitch.svg?raw';
import paperSvg from '../../assets/images/mcp/paper.svg?raw';

// PNG icons (imported as URLs)
import amplitudePng from '../../assets/images/mcp/amplitude.png';
import honeycombPng from '../../assets/images/mcp/honeycomb.png';
import exaPng from '../../assets/images/mcp/exa.png';
import jamPng from '../../assets/images/mcp/jam.png';
import motherduckPng from '../../assets/images/mcp/motherduck.png';
import magicPatternsPng from '../../assets/images/mcp/magic_patterns.png';
import deepwikiPng from '../../assets/images/mcp/deepwiki.png';

export interface McpIconDef {
  type: 'svg' | 'png';
  data: string;
  /** Brand hex color (without #) for background tinting */
  color: string;
  /** If true, render the SVG as-is without recoloring (for multi-color logos) */
  preserveColors?: boolean;
}

/**
 * Maps MCP catalog keys to their official brand icons.
 * SVG icons are from Simple Icons (CC0 licensed).
 * PNG icons are official favicons from the respective brands.
 */
export const mcpIconMap: Record<string, McpIconDef> = {
  playwright: { type: 'svg', data: playwrightSvg, color: '2EAD33' },
  context7: { type: 'svg', data: context7Svg, color: '000000', preserveColors: true },
  supabase: { type: 'svg', data: supabaseSvg, color: '3FCF8E' },
  vercel: { type: 'svg', data: vercelSvg, color: '000000' },
  sentry: { type: 'svg', data: sentrySvg, color: '362D59' },
  stripe: { type: 'svg', data: stripeSvg, color: '635BFF' },
  figma: { type: 'svg', data: figmaSvg, color: 'F24E1E' },
  linear: { type: 'svg', data: linearSvg, color: '5E6AD2' },
  slack: { type: 'svg', data: slackSvg, color: '4A154B' },
  cloudflare: { type: 'svg', data: cloudflareSvg, color: 'F38020' },
  netlify: { type: 'svg', data: netlifySvg, color: '00C7B7' },
  chrome_devtools: { type: 'svg', data: chromeDevtoolsSvg, color: '4285F4' },
  atlassian: { type: 'svg', data: atlassianSvg, color: '0052CC' },
  notion: { type: 'svg', data: notionSvg, color: '000000' },
  clerk: { type: 'svg', data: clerkSvg, color: '6C47FF' },
  planetscale: { type: 'svg', data: planetscaleSvg, color: '000000' },
  bigquery: { type: 'svg', data: bigquerySvg, color: '669DF6' },
  hugging_face: { type: 'svg', data: huggingFaceSvg, color: 'FFD21E' },
  posthog: { type: 'svg', data: posthogSvg, color: 'F9BD2B' },
  honeycomb: { type: 'png', data: honeycombPng, color: 'F6A61F' },
  graphos: { type: 'svg', data: graphosSvg, color: '311C87' },
  sanity: { type: 'svg', data: sanitySvg, color: 'F03E2F' },
  amplitude: { type: 'png', data: amplitudePng, color: '1C1E21' },
  asana: { type: 'svg', data: asanaSvg, color: 'F06A6A' },
  clickup: { type: 'svg', data: clickupSvg, color: '7B68EE' },
  microsoft_learn: { type: 'svg', data: microsoftLearnSvg, color: '5E5E5E' },
  jam: { type: 'png', data: jamPng, color: '6B57FF' },
  webflow: { type: 'svg', data: webflowSvg, color: '146EF5' },
  cloudinary: { type: 'svg', data: cloudinarySvg, color: '3448C5' },
  wordpress: { type: 'svg', data: wordpressSvg, color: '21759B' },
  canva: { type: 'svg', data: canvaSvg, color: '00C4CC' },
  miro: { type: 'svg', data: miroSvg, color: 'F7C922' },
  intercom: { type: 'svg', data: intercomSvg, color: '6AFDEF' },
  make: { type: 'svg', data: makeSvg, color: '6D00CC' },
  aws_marketplace: { type: 'svg', data: awsMarketplaceSvg, color: 'FF9900' },
  motherduck: { type: 'png', data: motherduckPng, color: 'FDCE00' },
  magic_patterns: { type: 'png', data: magicPatternsPng, color: '7C3AED' },
  wix: { type: 'svg', data: wixSvg, color: '0C6EFC' },
  devrev: { type: 'svg', data: devrevSvg, color: '0D0D0D', preserveColors: true },
  exa: { type: 'png', data: exaPng, color: '4F46E5' },
  deepwiki: { type: 'png', data: deepwikiPng, color: '0D0D0D' },
  dev_manager: { type: 'svg', data: '', color: '6B7280' },
  excalidraw: { type: 'svg', data: excalidrawSvg, color: '000000' },
  github: { type: 'svg', data: githubSvg, color: '181717' },
  stitch: { type: 'svg', data: stitchSvg, color: '4285F4' },
  paper: { type: 'svg', data: paperSvg, color: 'FF6B35' },
};
