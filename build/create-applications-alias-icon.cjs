/* eslint-disable */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const outIcns = path.resolve(process.argv[2] || 'build/applications-alias.icns');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'emdash-applications-icon-'));
const iconset = path.join(tmp, 'ApplicationsAlias.iconset');
fs.mkdirSync(iconset);

const python = `
from PIL import Image
from pathlib import Path
import sys, subprocess, os
base_icns = '/System/Library/CoreServices/CoreTypes.bundle/Contents/Resources/ApplicationsFolderIcon.icns'
badge_icns = '/System/Library/CoreServices/CoreTypes.bundle/Contents/Resources/AliasBadgeIcon.icns'
tmp = Path(r'''${tmp}''')
subprocess.check_call(['sips', '-s', 'format', 'png', base_icns, '--out', str(tmp / 'base.png')], stdout=subprocess.DEVNULL)
subprocess.check_call(['sips', '-s', 'format', 'png', badge_icns, '--out', str(tmp / 'badge.png')], stdout=subprocess.DEVNULL)
base = Image.open(tmp / 'base.png').convert('RGBA')
badge = Image.open(tmp / 'badge.png').convert('RGBA')
# Crop the actual black arrow from Apple's badge asset so we don't keep the white canvas.
alpha = badge.getchannel('A')
bbox = alpha.getbbox()
badge = badge.crop(bbox)
# Remove the white outline/shadow pixels; keep only the dark arrow like older DMG aliases.
pixels = badge.load()
for y in range(badge.height):
    for x in range(badge.width):
        r,g,b,a = pixels[x,y]
        if a == 0:
            continue
        # Keep only the dark arrow; drop the white/gray rounded badge background and shadow.
        if r < 80 and g < 80 and b < 80:
            pixels[x,y] = (18,24,28,a)
        else:
            pixels[x,y] = (255,255,255,0)

sizes = [(16,1),(16,2),(32,1),(32,2),(128,1),(128,2),(256,1),(256,2),(512,1),(512,2)]
iconset = Path(r'''${iconset}''')
for size, scale in sizes:
    px = size * scale
    img = base.resize((px, px), Image.Resampling.LANCZOS)
    # Match Finder's classic badge: bottom-left, about 30% of icon width.
    bw = max(1, round(px * 0.24))
    b = badge.resize((bw, bw), Image.Resampling.LANCZOS)
    x = round(px * 0.01)
    y = px - bw - round(px * 0.04)
    img.alpha_composite(b, (x, y))
    name = f'icon_{size}x{size}' + ('@2x' if scale == 2 else '') + '.png'
    img.save(iconset / name)
`;
execFileSync('python3', ['-c', python], { stdio: 'inherit' });
fs.mkdirSync(path.dirname(outIcns), { recursive: true });
execFileSync('iconutil', ['-c', 'icns', iconset, '-o', outIcns], { stdio: 'inherit' });
console.log(outIcns);
