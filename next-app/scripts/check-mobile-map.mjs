// Run with node scripts/check-mobile-map.mjs (no browser or credentials needed).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

function load(file) {
  const filename = path.resolve(import.meta.dirname, '../src', file);
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const loadedModule = { exports: {} };
  const localRequire = (name) => load(path.relative(path.resolve(import.meta.dirname, '../src'), path.resolve(path.dirname(filename), name + '.ts')));
  new Function('module', 'exports', 'require', source)(loadedModule, loadedModule.exports, localRequire);
  return loadedModule.exports;
}

const coord = (lat, lng) => ({ lat: () => lat, lng: () => lng });
const { syncViewportMarkers, buildInBatches } = load('lib/dashboard/marker-viewport.ts');
let south = 37, west = 126;
const map = { getBounds: () => ({ getSW: () => coord(south, west), getNE: () => coord(south + 1, west + 1) }) };
let attachments = 0;
function marker(lat, lng, status = '거래') {
  let attached = null;
  return {
    _status: status,
    getPosition: () => coord(lat, lng),
    getMap: () => attached,
    setMap: (next) => { attached = next; attachments++; },
  };
}

(async () => {
  const inside = marker(37.5, 126.5);
  const nearEdge = marker(38.2, 126.5);
  const farAway = marker(35, 129);
  const drop = marker(37.5, 126.5, 'DROP');
  const { emptyFilters, licenseMarkerVisible } = load('lib/dashboard/filters.ts');
  const filters = emptyFilters();
  const matches = (m) => licenseMarkerVisible(m, filters);
  const markers = [inside, nearEdge, farAway, drop];
  syncViewportMarkers(map, markers, matches);
  assert.equal(inside.getMap(), map);
  assert.equal(nearEdge.getMap(), map, 'preload a pan margin');
  assert.equal(farAway.getMap(), null);
  assert.equal(drop.getMap(), null);
  const firstPass = attachments;
  syncViewportMarkers(map, markers, matches);
  assert.equal(attachments, firstPass, 'idle without a change must do zero DOM attachments');
  south = 34.5; west = 128.5;
  syncViewportMarkers(map, markers, matches);
  assert.equal(inside.getMap(), null);
  assert.equal(farAway.getMap(), map, 'new viewport restores the marker');
  filters.status.add('미거래');
  syncViewportMarkers(map, markers, matches);
  assert.equal(farAway.getMap(), null, 'filters still apply after panning');
  filters.status.clear();
  south = 37; west = 126;
  syncViewportMarkers(map, markers, matches);
  assert.equal(inside.getMap(), map, 'pan back restores original markers');
  assert.equal(markers.length, 4, 'search retains the full marker collection');

  const many = Array.from({ length: 10000 }, (_, i) => marker(33 + (i % 100) * .07, 124 + Math.floor(i / 100) * .08));
  syncViewportMarkers(map, many, () => true);
  const visible = many.filter((m) => m.getMap()).length;
  assert(visible > 0 && visible < 1000);
  console.log(`Synthetic 10,000-marker field: ${visible} attached; full search collection retained.`);

  let count = 0, inputServiced = false;
  setTimeout(() => { inputServiced = true; }, 0);
  await buildInBatches(Array.from({ length: 30 }), () => {
    const start = performance.now();
    while (performance.now() - start < 1) { /* emulate SDK work */ }
    count++;
  }, () => false);
  assert.equal(count, 30);
  assert.equal(inputServiced, true, 'pending event serviced before all marker work finishes');
  count = 0;
  await buildInBatches([1, 2, 3, 4], () => count++, () => count === 2);
  assert.equal(count, 2, 'route changes cancel unfinished marker work');

  global.window = new EventTarget();
  window.visualViewport = new EventTarget();
  global.document = new EventTarget();
  document.visibilityState = 'visible';
  let observer, disconnected = false, nextFrame = 0;
  const frames = new Map();
  global.requestAnimationFrame = (fn) => { frames.set(++nextFrame, fn); return nextFrame; };
  global.cancelAnimationFrame = (id) => frames.delete(id);
  global.ResizeObserver = class {
    constructor(fn) { observer = fn; }
    observe() {}
    disconnect() { disconnected = true; }
  };
  const flush = () => { const work = [...frames.values()]; frames.clear(); work.forEach((fn) => fn()); };
  const { observeMapSize } = load('lib/map-resize.ts');
  const element = { clientWidth: 402, clientHeight: 0 };
  const sizes = [];
  const cleanup = observeMapSize(element, (w, h) => sizes.push([w, h]));
  flush(); assert.equal(sizes.length, 0, 'ignore a not-yet-laid-out map');
  element.clientHeight = 700;
  observer(); window.dispatchEvent(new Event('resize')); window.visualViewport.dispatchEvent(new Event('resize'));
  flush(); assert.deepEqual(sizes, [[402, 700]], 'coalesce startup resize events');
  observer(); flush(); assert.equal(sizes.length, 1, 'unchanged size does not repeatedly resize');
  element.clientHeight = 762; observer(); flush();
  assert.deepEqual(sizes.at(-1), [402, 762], 'late PWA height increase reaches SDK');
  window.dispatchEvent(new Event('pageshow')); flush(); assert.equal(sizes.length, 3, 'resume repaints even at the same size');
  document.visibilityState = 'hidden'; document.dispatchEvent(new Event('visibilitychange')); flush(); assert.equal(sizes.length, 3);
  document.visibilityState = 'visible'; document.dispatchEvent(new Event('visibilitychange')); flush(); assert.equal(sizes.length, 4);
  observer(); cleanup(); flush();
  window.dispatchEvent(new Event('resize')); window.dispatchEvent(new Event('pageshow')); flush();
  assert(disconnected); assert.equal(sizes.length, 4, 'no work after unmount');

  window.naver = { maps: { Point: class {} } };
  const { buildMarkerIcon } = load('lib/dashboard/markers.ts');
  const today = new Date();
  const date = (days) => { const d = new Date(today); d.setDate(d.getDate() + days); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  assert(buildMarkerIcon('인허가', { permit_date: date(-1) }).content.includes('marker-glow'));
  assert(!buildMarkerIcon('인허가', { permit_date: date(-60) }).content.includes('marker-glow'));
  assert(!buildMarkerIcon('인허가', { permit_date: date(2) }).content.includes('marker-glow'));
  console.log('PASS: pan/filter restoration, batching/cancellation, startup/resume resize, cleanup, new-permit highlight.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
