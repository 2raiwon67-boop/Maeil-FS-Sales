// node scripts/check-regional-priority.mjs — no credentials or database mutations.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { execFileSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
function load(file) {
  const filename = path.resolve(root, 'src', file);
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', source)(mod, mod.exports, name => load(path.relative(path.join(root, 'src'), path.resolve(path.dirname(filename), name + '.ts'))));
  return mod.exports;
}
const { regionalIndicators, rankRegions, lastCompleteMonth } = load('lib/regional-priority.ts');
const { monthShift } = load('lib/report-model.ts');
const event = (i, month, status = 'new', sido = '서울') => ({ name: `카페${i}`, addrKey: `주소${i}`, sido, sigungu: '중구', month, status });
const stores = [...Array.from({ length: 30 }, (_, i) => event(i, '2023-09')),
  ...Array.from({ length: 10 }, (_, i) => event(100 + i, '2025-06')),
  ...Array.from({ length: 20 }, (_, i) => event(200 + i, '2026-06')),
  event(0, '2025-09', 'closed'), event(1, '2025-10', 'closed')];
const input = { key: '서울|중구', label: '서울 중구', asOf: '2026-08', complete: true,
  population: [{ month: '2025-08', pop: 10000 }, { month: '2026-08', pop: 11000 }],
  collectedMonths: Array.from({ length: 36 }, (_, i) => monthShift('2023-09', i)), stores };
const result = regionalIndicators(input);
assert.ok(Math.abs(result.popGrowth - 10) < 0.00001);
assert.equal(result.newGrowth, 100);
assert.equal(result.cohort, 30);
assert.equal(result.closed24, 1, 'closure at exactly 24 months counts; month 25 does not');
assert.equal(result.comparable, true);
assert.equal(regionalIndicators({ ...input, complete: false }).survival, null, 'partial browser download must not imply survival');
assert.equal(regionalIndicators({ ...input, collectedMonths: input.collectedMonths.slice(1) }).survival, null);
assert.equal(regionalIndicators({ ...input, population: input.population.slice(1) }).popGrowth, null, 'no fabricated zero growth');
const duplicate = regionalIndicators({ ...input, stores: [...stores, stores[0], event(999, '2026-09')] });
assert.equal(duplicate.cohort, 30); assert.equal(duplicate.recent, 20, 'unfinished current month excluded');
const reopened = regionalIndicators({ ...input, stores: [...stores, event(0, '2024-01')] });
assert.equal(reopened.ambiguous, 1); assert.equal(reopened.cohort, 29); assert.equal(reopened.survival, null);
const sameName = regionalIndicators({ ...input, stores: [...stores, event(0, '2023-09', 'new', '부산')] });
assert.equal(sameName.cohort, 31, 'same name and address in a different province must not merge');
const unidentified = regionalIndicators({ ...input, stores: [...stores, { ...event(333, '2026-06'), addrKey: '' }] });
assert.equal(unidentified.comparable, false);
assert.equal(regionalIndicators({ ...input, stores: stores.filter(s => !s.month.startsWith('2025-06')) }).newGrowth, null, 'zero prior is not infinite growth');
assert.equal(rankRegions([result])[0].score, null);
assert.deepEqual(rankRegions([result, { ...result, key: 'other' }]).map(r => r.score), [50, 50], 'tied percentiles must be neutral');
assert.equal(lastCompleteMonth(new Date('2026-08-31T16:00:00Z')), '2026-08', 'Korean month boundary');

// Compare the pre-refactor policies with the shared module, preserving the two API scopes.
const shared = load('lib/store-exclusions.ts');
for (const api of ['market-stats', 'public-license']) {
  const original = execFileSync('git', ['show', `ad55408:next-app/src/app/api/${api}/route.ts`], { cwd: root, encoding: 'utf8' });
  const current = fs.readFileSync(path.join(root, 'src/app/api', api, 'route.ts'), 'utf8');
  const extract = text => text.match(/const EXCLUDE_KEYWORDS = \[[\s\S]*?\];/)[0];
  const before = new Function(`${extract(original)}; return EXCLUDE_KEYWORDS;`)();
  const after = new Function('SHARED_EXCLUDE_KEYWORDS', `${extract(current)}; return EXCLUDE_KEYWORDS;`)(shared.SHARED_EXCLUDE_KEYWORDS);
  assert.deepEqual([...new Set(after)].sort(), [...new Set(before)].sort(), `${api} exclusions must be unchanged`);
}
assert.equal(shared.isNonTargetName('에스프레소바', 0), false);
assert.equal(shared.isNonTargetName('베이커리', 0), false);
assert.equal(shared.isNonTargetName('한정식', 329), true);
assert.equal(shared.isNonTargetName('한정식', 330), false);
assert.equal(shared.CONVENIENCE_RE.test('Cuba cafe'), false);
assert.equal(shared.CONVENIENCE_RE.test('gs 25'), true);

const { validatePerformance } = load('lib/performance-diagnostics.ts');
const sample = { version: 1, at: new Date().toISOString(), route: '/discover', mobile: true, pwa: true, platform: 'ios', durationMs: 1000,
  mapReadyMs: 300, dataReadyMs: null, longTasks: null, blockingMs: null, maxInteractionMs: null, errors: 0 };
assert.deepEqual(validatePerformance({ ...sample, secret: 'must not be logged' }), sample);
assert.equal(validatePerformance({ ...sample, route: '/search?name=private' }), null);
assert.equal(validatePerformance({ ...sample, durationMs: -1 }), null);
assert.equal(validatePerformance({ ...sample, errors: NaN }), null);
console.log('PASS: regional periods, survival maturity, missing data, identities, ties, unchanged exclusions and telemetry privacy');
