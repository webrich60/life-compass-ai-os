import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');

test('side navigation keeps its own vertical scroll area and fixed controls', () => {
  assert.match(css, /#nav\{[^}]*min-height:0[^}]*overflow-y:scroll/);
  assert.match(css, /\.sidebar-bottom\{[^}]*flex:0 0 auto/);
  assert.match(html, /data-action="sync"/);
  assert.match(html, /data-page="settings"/);
});

test('tablet and mobile drawer supports backdrop, menu state, and Escape close', () => {
  assert.match(css, /@media\(max-width:980px\)/);
  assert.match(html, /id="sidebarBackdrop"/);
  assert.match(html, /aria-controls="sidebar" aria-expanded="false"/);
  assert.match(app, /function setSidebarOpen\(open\)/);
  assert.match(app, /event\.key==='Escape'/);
});
