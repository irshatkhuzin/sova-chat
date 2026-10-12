const { spawnSync } = require('node:child_process');
const path = require('node:path');
const tests = ['test-read-queue.cjs', 'test-inbox-panel.cjs', 'test-panel-reconnect.cjs',
  'test-widget-session.cjs', 'test-support.cjs', 'test-empty-install.cjs'];
for (const test of tests) {
  console.log(`\nRunning ${test}`);
  const result = spawnSync(process.execPath, [path.join(__dirname, test)], {
    cwd: path.resolve(__dirname, '..'), stdio: 'inherit', timeout: 30000,
    env: { ...process.env, NODE_ENV: 'test', OPENAI_API_KEY: '', LOG_LEVEL: 'silent',
      JWT_SECRET: 'isolated-test-only-secret-'.repeat(3), APP_ENCRYPTION_KEY: 'isolated-encryption-'.repeat(3) },
  });
  if (result.error || result.status !== 0) {
    console.error(result.error?.message || `${test} failed`); process.exit(1);
  }
}
console.log(`\nPassed ${tests.length} isolated regression scripts.`);
