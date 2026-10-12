const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
const { EventEmitter } = require('node:events');
const events = { Message: 'message', ConversationUpdated: 'updated', Handoff: 'handoff' };
const win = new EventTarget(), doc = new EventTarget();
function load(file) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: () => ({ PanelEvents: events }), window: win, document: doc, setTimeout, clearTimeout, setInterval, clearInterval });
  return exports;
}
const pause = () => new Promise(resolve => setTimeout(resolve, 180));
(async () => {
  const { sortConversations, canMarkRead } = load('packages/panel/src/lib/inbox-order.ts');
  const older = { id: '9007199254740993', lastMessageAt: '2026-10-08T10:00:00Z', unreadCount: 5, status: 'waiting_operator' };
  const newer = { id: '9007199254740994', lastMessageAt: '2026-10-08T11:00:00Z', unreadCount: 0, status: 'closed' };
  assert.equal(sortConversations([older, newer])[0].id, newer.id);
  assert.equal(sortConversations([{ ...older, unreadCount: 0, status: 'operator' }, newer])[0].id, newer.id);
  assert.equal(sortConversations([newer, { ...older, lastMessageAt: '2026-10-08T12:00:00Z' }])[0].id, older.id);
  assert.equal(sortConversations([{ ...older, lastMessageAt: newer.lastMessageAt }, newer])[0].id, newer.id);
  assert.equal(canMarkRead('1', '1', 'hidden', true), false);
  assert.equal(canMarkRead('1', '1', 'visible', false), false);
  assert.equal(canMarkRead('2', '1', 'visible', true), false);
  assert.equal(canMarkRead('1', '1', 'visible', true), true);
  console.log('PASS stable chronology, new messages move up, bigint tie-break, background tabs do not mark read');
  const { watchAttention, attentionTitle } = load('packages/panel/src/lib/attention.ts');
  assert.equal(attentionTitle(7), '(7) Sova — обращения для оператора');
  assert.equal(attentionTitle(0), 'Sova — панель поддержки');
  const socket = new EventEmitter(); let requests = 0, count = 4, fail = false, release;
  const seen = [];
  const stop = watchAttention(socket, async () => {
    requests++; if (release === 'hold') await new Promise(resolve => { release = resolve; });
    if (fail) throw Error('offline'); return { count };
  }, value => seen.push(value));
  await pause(); assert.equal(seen.at(-1), 4);
  count = 5; socket.emit('handoff'); socket.emit('updated'); socket.emit('message');
  await pause(); assert.equal(seen.at(-1), 5); assert.equal(requests, 2);
  fail = true; socket.emit('connect'); await pause(); assert.equal(seen.at(-1), 5);
  fail = false; count = 6; win.dispatchEvent(new Event('focus')); await pause(); assert.equal(seen.at(-1), 6);
  release = 'hold'; socket.emit('message'); await pause();
  socket.emit('handoff'); await pause(); count = 7; release(); await pause();
  assert.equal(seen.at(-1), 7);
  release = 'hold'; socket.emit('message'); await pause(); const previous = seen.length;
  stop(); count = 99; release(); await pause(); assert.equal(seen.length, previous);
  assert.equal(socket.listenerCount('message'), 0);
  console.log('PASS global counter: load, event coalescing, reconnect, focus, in-flight event, logout cleanup and tab title');
})().catch(error => { console.error(error); process.exitCode = 1; });
