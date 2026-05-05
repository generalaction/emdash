import type { MermaidConfig } from 'mermaid';

let idCounter = 0;
let renderQueue: Promise<void> = Promise.resolve();

type MermaidTheme = NonNullable<MermaidConfig['theme']>;

interface MermaidRenderRequest {
  id: string;
  chart: string;
  theme: MermaidTheme;
}

export function createMermaidRenderId(): string {
  idCounter += 1;
  return `emdash-mermaid-${idCounter}`;
}

export async function renderMermaidDiagram({
  id,
  chart,
  theme,
}: MermaidRenderRequest): Promise<string> {
  const render = async () => {
    const mermaid = (await import('mermaid')).default;
    const config: MermaidConfig = {
      startOnLoad: false,
      securityLevel: 'strict',
      suppressErrorRendering: true,
      theme,
    };

    mermaid.initialize(config);
    const { svg } = await mermaid.render(id, chart);
    return svg;
  };

  const result = renderQueue.then(render, render);
  renderQueue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}
