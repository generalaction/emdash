/**
 * BlockStack — renders a pre-laid-out block array inside a positioned container.
 *
 * Each block is dispatched to its specialist renderer (Prose / Code / Table /
 * Island). Blocks with height === 0 (collapsed placeholders) are skipped.
 *
 * Callers are responsible for supplying a container with `position: relative`
 * (or absolute) and sufficient height so the absolutely-placed BlockFrames
 * are not clipped.
 *
 * This component is extracted from Message.tsx so both the message row and
 * the thinking expanded body share the same render pipeline.
 */

import { For } from 'solid-js';
import type { ProseBlock, CodeBlock, Block } from '../../core/blocks/block-types';
import type {
  BlockLaidOut,
  CodeLaidOut,
  IslandLaidOut,
  ProseLaidOut,
  TableLaidOut,
} from '../../core/layout/layout-types';
import { Code } from '../code/Code';
import { Island } from '../island/Island';
import { Prose } from '../prose/Prose';
import { Table } from '../table/Table';

export type BlockStackProps = {
  /** Parsed raw blocks — needed for run data, code text, island raw. */
  blocks: Block[];
  /** Pre-computed geometry from layoutBlocks. */
  laid: BlockLaidOut[];
  /** Called when an island block measures its DOM height (write-back path). */
  onIslandMeasured?: (id: string, height: number) => void;
};

function renderBlock(
  laidBlock: BlockLaidOut,
  blocks: Block[],
  onIslandMeasured?: (id: string, h: number) => void
) {
  if (laidBlock.height === 0) return null;
  const rawBlock = blocks.find((b) => b.id === laidBlock.id);
  if (!rawBlock) return null;

  if (laidBlock.kind === 'prose') {
    const pb = rawBlock as ProseBlock;
    return <Prose block={laidBlock as ProseLaidOut} runs={pb.runs} variant={pb.variant} />;
  }
  if (laidBlock.kind === 'code') {
    return <Code block={laidBlock as CodeLaidOut} rawBlock={rawBlock as CodeBlock} />;
  }
  if (laidBlock.kind === 'table') {
    return <Table block={laidBlock as TableLaidOut} />;
  }
  return <Island block={laidBlock as IslandLaidOut} onMeasured={onIslandMeasured} />;
}

export function BlockStack(props: BlockStackProps) {
  return (
    <For each={props.laid}>
      {(laidBlock) => renderBlock(laidBlock, props.blocks, props.onIslandMeasured)}
    </For>
  );
}
