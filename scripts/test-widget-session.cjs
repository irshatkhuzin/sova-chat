const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
let calls = 0, rendered = [];
const settings = { locale: 'en', greeting: 'Hello' };
class Storage { constructor() { this.sessionToken = 'saved-session'; this.opened = true; this.pending = []; this.lastSeq = 0; } }
class Api {
  async config() { return { settings }; }
  setToken(token) { this.token = token; }
  async history() {
    calls++;
    assert.equal(this.token, 'saved-session', 'Auto-open must wait until API token is restored');
    return { conversationId: '1', status: 'operator', lastSeq: 1, messages: [{ id: '1', seq: 1, author: 'user', text: 'Existing history', createdAt: new Date().toISOString() }] };
  }
}
class Ui {
  constructor(_s, _strings, callbacks) { this.callbacks = callbacks; }
  mount() {}
  setOpen(open) { this.open = open; this.callbacks.onToggle(open); }
  isOpen() { return this.open; }
  setUnread() {} setConnection() {} setAgentTyping() {} destroy() {}
  showError(error) { throw new Error(error); }
  renderMessages(messages) { rendered = messages; }
}
const exportsObject = {};
const socket = { connected: false, on() { return this; }, close() {}, volatile: { emit() {} } };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('packages/widget/src/chat.ts','utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
 { exports: exportsObject, require(name) {
   if (name === 'socket.io-client') return { io: () => socket };
   if (name === '@sova/shared') return { DEFAULT_WIDGET_SETTINGS: settings, CLIENT_NAMESPACE: '/client', ClientCommands: {}, ClientEvents: {} };
   if (name === './api.js') return { WidgetApi: Api };
   if (name === './i18n.js') return { pickStrings: () => ({}), detectBrowserLocale: () => 'en' };
   if (name === './storage.js') return { WidgetStorage: Storage };
   if (name === './ui.js') return { WidgetUi: Ui };
   if (name === './read-receipts.js') return { ReadReceiptQueue: class { wake() {} add() {} reset() {} } };
   throw new Error(name);
 }, URL, window: { addEventListener() {}, removeEventListener() {}, clearTimeout, setTimeout }, document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} } });
(async () => {
  const chat = new exportsObject.SovaChat({ serverUrl: 'https://example.test/chat', channelPublicId: 'test', autoOpen: true });
  await chat.init();
  assert.equal(calls, 1); assert.equal(rendered[0].text, 'Existing history');
  chat.destroy();
  console.log('PASS auto-open restores the session before requesting history, without duplicate anonymous session');
})().catch(err => { console.error(err); process.exitCode = 1; });
