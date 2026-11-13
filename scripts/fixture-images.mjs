// Draws the images the demo pages under test/fixtures/site need, so they can be rebuilt
// instead of trusted as binary blobs:
//   node scripts/fixture-images.mjs
// text-banner.png is an image of text (a heading drawn into a picture), for the images of
// text check. It is rendered by the browser from plain HTML and screenshotted.
// mid.png is a flat mid grey: white text on it reaches about 5.3:1, between the 4.5:1 of
// level AA and the 7:1 of level AAA.
// sound.webm (not drawn here) is five seconds of a quiet tone over a dark frame, made with:
//   ffmpeg -f lavfi -i color=c=0x1c2733:s=160x90:r=10:d=5 -f lavfi -i sine=frequency=440:duration=5:sample_rate=16000 \
//     -af volume=0.05 -c:v libvpx -b:v 20k -c:a libopus -b:a 12k -shortest sound.webm
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const SITE = fileURLToPath(new URL('../test/fixtures/site/', import.meta.url));
const IMAGES = {
  'text-banner.png': {
    width: 480, height: 160,
    html: '<div style="width:480px;height:160px;background:#0b3d6e;color:#fff;font:700 34px/1.25 Arial,sans-serif;display:flex;flex-direction:column;justify-content:center;padding:0 28px;box-sizing:border-box">Spring food drive<br><span style="font-weight:400;font-size:24px">Saturday at the community center</span></div>',
  },
};

const flat = (width, height, [r, g, b]) => {
  const png = new PNG({ width, height });
  for (let i = 0; i < png.data.length; i += 4) png.data.set([r, g, b, 255], i);
  return PNG.sync.write(png);
};
writeFileSync(SITE + 'mid.png', flat(64, 64, [0x6b, 0x6b, 0x6b]));
console.log('wrote test/fixtures/site/mid.png');

const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
try {
  for (const [name, { width, height, html }] of Object.entries(IMAGES)) {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.setContent(`<!doctype html><html><body style="margin:0">${html}</body></html>`);
    writeFileSync(SITE + name, await page.screenshot({ clip: { x: 0, y: 0, width, height } }));
    await page.close();
    console.log(`wrote test/fixtures/site/${name}`);
  }
} finally {
  await browser.close();
}
