const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
const exportsObject = {}, timers = new Map(); let next = 0;
vm.runInNewContext(ts.transpileModule(fs.readFileSync('packages/widget/src/read-receipts.ts','utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  { exports: exportsObject, setTimeout: fn => { timers.set(++next, fn); return next; }, clearTimeout: id => timers.delete(id) });
const tick = async () => { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(fn => fn()); await new Promise(r => setImmediate(r)); };
(async () => {
  let active = false, fail = false, defer, calls = [];
  const queue = new exportsObject.ReadReceiptQueue(() => active, async ids => { calls.push([...ids]); if (fail) throw Error('offline'); if (defer) await defer; });
  queue.add(['1','1','2','greeting']); await tick(); assert.equal(calls.length, 0, 'No read when hidden/closed/unfocused');
  active = true; queue.wake(); await tick(); assert.deepEqual(calls, [['1','2']]);
  queue.add(['1']); await tick(); assert.equal(calls.length, 1, 'No repeat writes for acknowledged IDs');
  fail = true; queue.add(['3']); await tick(); assert.equal(calls.length, 2);
  active = false; await tick(); assert.equal(calls.length, 2, 'No background retry');
  active = true; fail = false; queue.wake(); await tick(); assert.deepEqual(calls[2], ['3']);
  queue.reset(); queue.add(Array.from({length:205}, (_,i)=>String(i+10))); await tick(); await tick(); await tick();
  assert.deepEqual(calls.slice(-3).map(ids=>ids.length), [100,100,5]);
  let release; defer = new Promise(r => release = r); queue.add(['999']); await tick(); queue.reset(); defer = null; queue.add(['1000']); release(); await tick(); await tick();
  assert.deepEqual(calls.at(-1), ['1000']); queue.reset();
  console.log('PASS visible-only batching, duplicate suppression, retry after focus/reconnect, bounded batches, logout race');
})().catch(err => { console.error(err); process.exitCode = 1; });
