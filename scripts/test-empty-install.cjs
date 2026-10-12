const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const code = file => require('../packages/server/dist/src/' + file);
// Exercise the actual migration runner against a recording, empty database double.
const db = code('infra/db.js');
const statements = [];
const connection = { query: async (sql, args) => { statements.push({ sql, args }); return [[], []]; }, release() {} };
db.getPool = () => ({ query: connection.query, getConnection: async () => connection });
db.query = async () => [];
db.queryOne = async () => null;
(async () => {
  const migrations = await code('infra/migrate.js').runMigrations();
  assert.ok(migrations.length > 0);
  for (const { sql } of statements) {
    assert.ok(!/\b(?:INSERT\s+INTO|REPLACE\s+INTO)\s+sova_(?!migrations\b)/i.test(sql), 'Migrations must not preload application data');
  }
  assert.deepEqual(await code('modules/products/product.service.js').listProducts(), []);
  assert.deepEqual(await code('modules/channels/channel.service.js').listChannels(), []);
  assert.deepEqual(await code('modules/knowledge/knowledge.service.js').listArticles('1'), []);
  assert.deepEqual(await code('modules/ai/instructions.service.js').readInstructions(), { filter: '', support: '', translation: '', learning: '' });
  assert.equal(await code('modules/ai/settings.service.js').isAgentReady('support'), false);
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
  assert.equal(pkg.scripts.seed, undefined);
  assert.equal(fs.existsSync(path.join(__dirname, '../packages/server/src/cli/seed.ts')), false);
  console.log('PASS migration runner creates schema without preset data; products and owner instructions start empty');
})().catch(error => { console.error(error); process.exitCode = 1; });
