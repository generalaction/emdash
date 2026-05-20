/* eslint-disable */
// Renders build/dmg-background.html to build/dmg-background.png (660x400) and
// build/dmg-background@2x.png (1320x800).
//
//   pnpm run dmg:background
//
// Reads the window's actual devicePixelRatio after load (since the primary
// display can be non-retina while the offscreen window lands on the retina
// laptop screen), then resizes the BrowserWindow so the logical viewport
// matches 660x400 regardless of which display the window opens on.

const { app, BrowserWindow } = require('electron');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE_HTML = path.join(__dirname, 'dmg-background.html');
const OUT_1X = path.join(__dirname, 'dmg-background.png');
const OUT_2X = path.join(__dirname, 'dmg-background@2x.png');

const WIDTH = 660;
const HEIGHT = 400;

const PKG_VERSION = require(path.join(__dirname, '..', 'package.json')).version;

// Web fonts (Inter, JetBrains Mono) load asynchronously; pad after
// document.fonts.ready as a belt-and-suspenders safety margin.
const FONT_SETTLE_MS = 1200;

app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
      show: false,
      frame: false,
      backgroundColor: '#FFFFFF',
      webPreferences: {},
    });

    // Inject package.json version into the __VERSION__ placeholder via a
    // data: URL so the source HTML stays version-agnostic.
    const html = fs.readFileSync(SOURCE_HTML, 'utf8').replace(/__VERSION__/g, PKG_VERSION);
    await win.loadURL('data:text/html;charset=utf-8;base64,' + Buffer.from(html).toString('base64'));

    // Detect the window's actual DPR and resize so logical viewport == 660x400.
    const dpr = await win.webContents.executeJavaScript('window.devicePixelRatio');
    if (dpr !== 1) {
      win.setSize(WIDTH * dpr, HEIGHT * dpr);
      await new Promise((r) => setTimeout(r, 150));
    }

    const viewport = await win.webContents.executeJavaScript(
      `JSON.stringify({ iw: innerWidth, ih: innerHeight, dpr: devicePixelRatio })`,
    );
    console.log('viewport after sizing:', viewport);

    await win.webContents.executeJavaScript(
      `document.fonts ? document.fonts.ready.then(() => true) : true`,
    );
    await new Promise((r) => setTimeout(r, FONT_SETTLE_MS));

    const image = await win.webContents.capturePage({
      x: 0,
      y: 0,
      width: WIDTH,
      height: HEIGHT,
    });
    const sz = image.getSize();
    console.log(`captured image: ${sz.width}x${sz.height}`);

    // capturePage returns the image at physical pixel size (logical * DPR).
    // For @1x we want 660x400 pixels; for @2x we want 1320x800 pixels.
    // If captured size is already 1320x800 (DPR=2), it IS the @2x. Otherwise
    // we use sips to upscale.
    if (sz.width === WIDTH * 2 && sz.height === HEIGHT * 2) {
      fs.writeFileSync(OUT_2X, image.toPNG());
      // Downscale via Electron's nativeImage for sharper @1x
      const small = image.resize({ width: WIDTH, height: HEIGHT, quality: 'best' });
      fs.writeFileSync(OUT_1X, small.toPNG());
      console.log(`wrote @2x natively, downscaled @1x`);
    } else {
      fs.writeFileSync(OUT_1X, image.toPNG());
      fs.copyFileSync(OUT_1X, OUT_2X);
      execFileSync(
        'sips',
        ['--resampleHeightWidth', String(HEIGHT * 2), String(WIDTH * 2), OUT_2X],
        { stdio: 'ignore' },
      );
      console.log(`wrote @1x natively, sips upscale for @2x`);
    }
    console.log(`out: ${path.relative(process.cwd(), OUT_1X)} (${WIDTH}x${HEIGHT})`);
    console.log(`out: ${path.relative(process.cwd(), OUT_2X)} (${WIDTH * 2}x${HEIGHT * 2})`);

    win.destroy();
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    app.quit();
  }
});
