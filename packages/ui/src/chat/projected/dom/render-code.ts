/**
 * render-code — imperative DOM rendering for CodeLaidOut.
 *
 * Returns the root .pblock element containing positioned .pcode-line rows.
 * If a slot is provided, delegates to it via applyMountResult and returns
 * a dispose callback to unmount the slot when the row is recycled.
 */

import type { Block } from '../../blocks/block-types';
import type { CodeLaidOut } from '../layout/layout-types';
import type { ImperativeSlots } from '../slots';
import { applyMountResult } from '../slots';
import { el } from './dom-utils';
import style from '../projected.module.css';

export type RenderCodeResult = {
  node: HTMLElement;
  dispose: () => void;
};

export function renderCode(
  block: CodeLaidOut,
  rawBlock: Block & { tier: 'code' },
  slots?: ImperativeSlots
): RenderCodeResult {
  const wrapper = el('div', {
    className: `${style['pblock']} ${style['pcode-block']}`,
    style: {
      top: `${block.top}px`,
      height: `${block.height}px`,
      left: '0',
      right: '0',
    },
  });

  if (slots?.renderCode) {
    const unmount = applyMountResult(wrapper, slots.renderCode(rawBlock));
    return { node: wrapper, dispose: unmount };
  }

  if (block.lang) {
    const label = el('div', {
      className: style['pcode-lang'],
      children: [block.lang],
    });
    wrapper.appendChild(label);
  }

  for (const line of block.lines) {
    const lineEl = el('div', {
      className: style['pcode-line'],
      style: { top: `${line.top}px` },
      children: [line.text],
    });
    wrapper.appendChild(lineEl);
  }

  return { node: wrapper, dispose: () => {} };
}
