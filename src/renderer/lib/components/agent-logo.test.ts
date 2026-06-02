import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { agentConfig } from '@renderer/utils/agentConfig';
import AgentLogo from './agent-logo';

vi.mock('@renderer/lib/hooks/useTheme', () => ({
  useTheme: () => ({ effectiveTheme: 'emdark' }),
}));

const blackSvg = '<svg viewBox="0 0 1 1" fill="none"><path d="M0 0h1v1H0z" fill="black"/></svg>';
const whiteSvg = '<svg viewBox="0 0 1 1" fill="none"><path d="M0 0h1v1H0z" fill="white"/></svg>';

describe('AgentLogo', () => {
  it('inverts dark-mode SVG logos without rewriting their markup', () => {
    const html = renderToStaticMarkup(
      React.createElement(AgentLogo, {
        logo: blackSvg,
        alt: 'Cursor CLI',
        isSvg: true,
        invertInDark: true,
      })
    );

    expect(html).toMatch(/class="[^"]*\binvert\b/);
    expect(html).toContain('fill="none"');
    expect(html).toContain('fill="black"');
    expect(html).not.toContain('currentColor');
    expect(html).not.toContain('text-primary');
  });

  it('uses explicit dark SVG variants instead of inverting them', () => {
    const html = renderToStaticMarkup(
      React.createElement(AgentLogo, {
        logo: blackSvg,
        logoDark: whiteSvg,
        alt: 'OpenCode CLI',
        isSvg: true,
        invertInDark: true,
      })
    );

    expect(html).not.toMatch(/class="[^"]*\binvert\b/);
    expect(html).toContain('fill="white"');
    expect(html).not.toContain('fill="black"');
  });

  it('renders Kimi as inline SVG so its currentColor mark follows the UI theme', () => {
    const kimi = agentConfig.kimi;
    const html = renderToStaticMarkup(
      React.createElement(AgentLogo, {
        logo: kimi.logo,
        alt: kimi.alt,
        isSvg: kimi.isSvg,
      })
    );

    expect(html).toContain('<svg');
    expect(html).toContain('fill="currentColor"');
    expect(html).not.toContain('<img');
  });
});
