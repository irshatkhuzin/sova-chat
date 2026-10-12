// Inspect the publication file set without printing matching secret values.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const files = [...new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).split('\0').filter(Boolean))];
const published = new Set(files);
const problems = [];
const forbidden = /(?:^|\/)(?:node_modules|dist|build|storage|backups|exports|snapshots|\.local|\.gradle|\.idea)(?:\/|$)|\.ru\.md$|\.(?:tgz|zip|dump|pem|key|p12|pfx|jks|keystore|bak|log)$|\.sql\.gz$|(?:^|\/)local\.properties$/i;
const signatures = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{40,}\b/,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{40,}\b/,
  /\bAKIA[A-Z0-9]{16}\b/,
  /https?:\/\/[^\s/:]+:[^\s/@]+@/,
];
for (const file of files) {
  if (forbidden.test(file) || (/^\.env(?:\.|$)/.test(path.basename(file)) && path.basename(file) !== '.env.example')) {
    problems.push(`${file}: private/generated path included`); continue;
  }
  const full = path.join(root, file);
  if (!fs.existsSync(full)) { problems.push(`${file}: tracked file missing`); continue; }
  if (fs.lstatSync(full).isSymbolicLink()) { problems.push(`${file}: symlink requires review`); continue; }
  const bytes = fs.readFileSync(full);
  if (bytes.length > 10 * 1024 * 1024) problems.push(`${file}: large file requires review`);
  if (bytes.includes(0)) continue;
  const text = bytes.toString('utf8');
  // This exact reserved-domain URL is a negative test for rejecting URL credentials.
  const scanText = text.replaceAll('https://user:password@example.com', 'https://example.com');
  if (signatures.some(pattern => pattern.test(scanText))) problems.push(`${file}: possible credential (value suppressed)`);
  if (/\.md$/i.test(file)) {
    if (/[\u0400-\u04ff]/u.test(text)) problems.push(`${file}: public documentation must be English`);
    for (const match of text.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const link = match[1];
      if (/^(?:[a-z]+:|#|\/)/i.test(link)) continue;
      const target = decodeURIComponent(link.split('#')[0]);
      if (!target) continue;
      const relative = path.relative(root, path.resolve(path.dirname(full), target)).split(path.sep).join('/');
      if (!published.has(relative)) problems.push(`${file}: link target not in publication: ${relative}`);
    }
  }
}
if (problems.length) { console.error(problems.join('\n')); process.exitCode = 1; }
else console.log(`Publication checks passed for ${files.length} files. Manual review is still required.`);
