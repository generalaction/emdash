import React, { useEffect, useRef } from 'react';
import type { TerminalColorScheme } from '@shared/terminal-color-schemes';

interface TerminalPreviewProps {
  colorScheme: TerminalColorScheme;
  className?: string;
}

export function TerminalPreview({ colorScheme, className }: TerminalPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    // Clear canvas with background color
    ctx.fillStyle = colorScheme.background;
    ctx.fillRect(0, 0, rect.width, rect.height);

    // Set font
    ctx.font = '12px "SF Mono", Monaco, "Courier New", monospace';

    // Sample terminal content
    const lines = [
      { text: '$ ', color: colorScheme.green },
      { text: 'npm ', color: colorScheme.foreground },
      { text: 'run ', color: colorScheme.foreground },
      { text: 'dev', color: colorScheme.yellow },
      { text: '\n', color: '' },
      { text: '> ', color: colorScheme.green },
      { text: 'emdash@0.2.9 ', color: colorScheme.cyan },
      { text: 'dev', color: colorScheme.yellow },
      { text: '\n', color: '' },
      { text: '> ', color: colorScheme.green },
      { text: 'npm-run-all -p ', color: colorScheme.foreground },
      { text: 'dev:*', color: colorScheme.magenta },
    ];

    // Draw text
    let x = 10;
    let y = 25;
    const lineHeight = 18;

    lines.forEach((segment) => {
      if (segment.text === '\n') {
        x = 10;
        y += lineHeight;
      } else {
        ctx.fillStyle = segment.color || colorScheme.foreground;
        ctx.fillText(segment.text, x, y);
        x += ctx.measureText(segment.text).width;
      }
    });

    // Draw cursor
    ctx.fillStyle = colorScheme.cursor;
    ctx.fillRect(x, y - 12, 8, 14);

    // Draw ANSI color palette at the bottom
    const colorPalette = [
      { name: 'Black', normal: colorScheme.black, bright: colorScheme.brightBlack },
      { name: 'Red', normal: colorScheme.red, bright: colorScheme.brightRed },
      { name: 'Green', normal: colorScheme.green, bright: colorScheme.brightGreen },
      { name: 'Yellow', normal: colorScheme.yellow, bright: colorScheme.brightYellow },
      { name: 'Blue', normal: colorScheme.blue, bright: colorScheme.brightBlue },
      { name: 'Magenta', normal: colorScheme.magenta, bright: colorScheme.brightMagenta },
      { name: 'Cyan', normal: colorScheme.cyan, bright: colorScheme.brightCyan },
      { name: 'White', normal: colorScheme.white, bright: colorScheme.brightWhite },
    ];

    const paletteY = rect.height - 40;
    const blockSize = 20;
    const spacing = 4;
    let paletteX = 10;

    // Draw color blocks
    colorPalette.forEach((color) => {
      // Normal color
      ctx.fillStyle = color.normal;
      ctx.fillRect(paletteX, paletteY, blockSize, blockSize);

      // Bright color
      ctx.fillStyle = color.bright;
      ctx.fillRect(paletteX, paletteY + blockSize + spacing, blockSize, blockSize);

      paletteX += blockSize + spacing;
    });

    // Add selection highlight example
    ctx.fillStyle = colorScheme.selectionBackground;
    ctx.globalAlpha = 0.5;
    ctx.fillRect(30, 20, 100, 18);
    ctx.globalAlpha = 1;
  }, [colorScheme]);

  return (
    <div className={className}>
      <canvas
        ref={canvasRef}
        className="h-full w-full rounded border border-border bg-black"
        style={{ imageRendering: 'pixelated' }}
      />
    </div>
  );
}
