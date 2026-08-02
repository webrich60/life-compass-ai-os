import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('../manifest.webmanifest', import.meta.url), 'utf8'));

test('plain URL is normalized to the home route before the first render', () => {
  assert.match(app, /function initialPage\(\)/);
  assert.match(app, /history\.replaceState\(null, '', `\$\{location\.pathname\}\$\{location\.search\}#\$\{normalized\}`\)/);
  assert.match(app, /let page = initialPage\(\)/);
  assert.equal(manifest.start_url, './index.html#home');
});

test('published shell files use one cache-busting version', () => {
  for (const asset of ['manifest.webmanifest','styles.css','src/app.js']) {
    assert.match(html, new RegExp(`${asset.replace('.', '\\.') }\\?v=2\\.2\\.0`));
  }
  assert.match(sw, /life-compass-ai-os-v2\.2\.0/);
  assert.match(app, /sw\.js\?v=2\.2\.0/);
  assert.match(app, /life-compass-sw-refresh-v2\.2\.0/);
  assert.match(sw, /cache:'no-store'/);
  assert.match(sw, /event\.request\.mode==='navigate'/);
});
