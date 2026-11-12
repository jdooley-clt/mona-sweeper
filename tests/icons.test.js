import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { MAP, PNG_ICONS, png, svg } from '../scripts/icons.mjs';
import { PUBLISHED } from '../scripts/serve.mjs';

const root = new URL('../', import.meta.url);
const rootDir = fileURLToPath(root);
const SITE_BASELINE_RAW_BYTES = 166_883;
const SITE_BASELINE_GZIP_BYTES = 96_350;
const read = (path) => readFile(new URL(path, root));
const pngSize = (buf) => {
  assert.equal(buf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'PNG signature');
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
};

test('committed icons match the pixel map (run npm run icons after editing it)', async () => {
  assert.equal((await read('assets/favicon.svg')).toString(), svg());
  for (const icon of PNG_ICONS) assert.ok((await read(`assets/${icon.file}`)).equals(png(icon)), icon.file);
});

test('manifest is installable and every icon exists at its declared size', async () => {
  const manifest = JSON.parse(await read('manifest.webmanifest'));
  for (const field of ['name', 'short_name', 'start_url', 'display', 'background_color', 'theme_color']) {
    assert.ok(manifest[field], field);
  }
  assert.equal(manifest.start_url, './', 'relative so it works under /mona-sweeper/');
  for (const size of ['192x192', '512x512']) {
    for (const purpose of ['any', 'maskable']) {
      assert.ok(manifest.icons.some((i) => i.sizes === size && i.purpose === purpose && i.type === 'image/png'), `${purpose} ${size}`);
    }
  }
  for (const icon of manifest.icons) {
    assert.match(icon.src, /^\.\/assets\//);
    const file = await read(icon.src);
    if (icon.type === 'image/png') assert.deepEqual(pngSize(file), icon.sizes.split('x').map(Number), icon.src);
  }
  assert.ok(PUBLISHED.includes('manifest.webmanifest'), 'manifest is deployed');
});

test('maskable icons keep Mona inside the 80% safe zone; Apple icon is opaque', () => {
  let minX = 16, minY = 16, maxX = 0, maxY = 0;
  MAP.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === '.' || ch === 'l') return;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + 1);
    maxY = Math.max(maxY, y + 1);
  }));
  assert.ok(PNG_ICONS.find((i) => i.file === 'apple-touch-icon.png').opaque, 'iOS renders transparency as black');
  for (const { file, cell, pad } of PNG_ICONS.filter((i) => i.file.includes('maskable'))) {
    const size = 16 * cell + 2 * pad, c = size / 2, r = size * 0.4;
    for (const [x, y] of [[minX, minY], [maxX, minY], [minX, maxY], [maxX, maxY]]) {
      assert.ok(Math.hypot(pad + x * cell - c, pad + y * cell - c) <= r, `${file} corner ${x},${y}`);
    }
  }
});

test('index.html enforces strict CSP, referrer policy, external scripts only, and standalone footer links', async () => {
  const html = (await read('index.html')).toString();
  for (const tag of [
    'http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; style-src \'self\'; img-src \'self\' data:; font-src \'self\'; connect-src \'self\'; base-uri \'none\'; form-action \'none\'; object-src \'none\'"',
    'name="referrer" content="strict-origin-when-cross-origin"',
    'rel="manifest" href="./manifest.webmanifest"',
    'rel="apple-touch-icon" href="./assets/apple-touch-icon.png"',
    'name="theme-color"',
    '<script src="./src/theme.js"></script>',
    'id="arcade-link" class="arcade-link" href="https://jdooley-clt.github.io/arcade/" hidden>More games in GitHub Arcade</a>',
    'id="source-link" class="source-link" href="https://github.com/jdooley-clt/mona-sweeper" hidden>Source &amp; credits</a>',
  ]) {
    assert.ok(html.includes(tag), tag);
  }
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)/i, 'no inline <script> blocks');
  assert.doesNotMatch(html, /\sstyle=/i, 'no inline style attributes');
  for (const match of html.matchAll(/<a\b[^>]*\btarget=["']_blank["'][^>]*>/gi)) {
    assert.match(match[0], /\brel=["'][^"']*\bnoopener\b[^"']*\bnoreferrer\b[^"']*["']/i, match[0]);
  }
  const themeJs = (await read('src/theme.js')).toString();
  assert.match(themeJs, /document\.documentElement\.dataset\.theme/);
  const mainJs = (await read('src/main.js')).toString();
  assert.doesNotMatch(mainJs, /\.style\b/, 'no runtime element.style mutations under strict style-src');
});

test('cover, character SVGs, gameplay PNG, and README arcade backlink are valid', async () => {
  const cover = (await read('assets/mona-sweeper-cover.svg')).toString();
  assert.match(cover, /viewBox="0 0 640 360"/);
  assert.doesNotMatch(cover, /<script|<image|https?:\/\/(?!www\.w3\.org)/);
  const character = (await read('assets/mona-sweeper-character.svg')).toString();
  assert.match(character, /M3 0h4v2h14V0h4v8/);
  assert.doesNotMatch(character, /<script|<image|https?:\/\/(?!www\.w3\.org)/);
  const gameplay = await read('assets/mona-sweeper.png');
  const [w, h] = pngSize(gameplay);
  assert.ok(w >= 640 && h >= 360, `gameplay PNG size ${w}x${h}`);
  const readme = (await read('README.md')).toString();
  assert.match(readme, /https:\/\/jdooley-clt\.github\.io\/mona-sweeper\//);
  assert.match(readme, /\[GitHub Arcade\]\(https:\/\/jdooley-clt\.github\.io\/arcade\/\)/);
  assert.match(readme, /Direct pushes to `main` are blocked/);
});

async function measureSiteBytes(dir) {
  let rawBytes = 0;
  let gzipBytes = 0;
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else {
        const buf = await readFile(full);
        rawBytes += buf.length;
        if (buf.length > 0) gzipBytes += gzipSync(buf, { level: 9 }).length;
      }
    }
  }
  await walk(dir);
  return { rawBytes, gzipBytes };
}

test('staged _site payload stays within 10% of the raw and gzipped baseline budget', async (t) => {
  const staged = await mkdtemp(join(tmpdir(), 'mona-sweeper-site-'));
  t.after(() => rm(staged, { recursive: true, force: true }));
  for (const entry of PUBLISHED) {
    await cp(join(rootDir, entry), join(staged, entry), { recursive: true });
  }
  await writeFile(join(staged, '.nojekyll'), '');

  const { rawBytes, gzipBytes } = await measureSiteBytes(staged);
  const maxRaw = Math.floor(SITE_BASELINE_RAW_BYTES * 1.10);
  const maxGzip = Math.floor(SITE_BASELINE_GZIP_BYTES * 1.10);
  assert.ok(
    rawBytes <= maxRaw,
    `staged _site raw payload ${rawBytes} B exceeds +10% budget ${maxRaw} B (baseline ${SITE_BASELINE_RAW_BYTES} B)`
  );
  assert.ok(
    gzipBytes <= maxGzip,
    `staged _site gzip payload ${gzipBytes} B exceeds +10% budget ${maxGzip} B (baseline ${SITE_BASELINE_GZIP_BYTES} B)`
  );

  const existingSite = join(rootDir, '_site');
  const existingStat = await stat(existingSite).catch(() => null);
  if (existingStat?.isDirectory()) {
    assert.deepEqual(await measureSiteBytes(existingSite), { rawBytes, gzipBytes });
  }
});
