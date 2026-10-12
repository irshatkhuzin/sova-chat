// Create a source-only ZIP using built-in Node APIs (no platform-specific tools).
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const sdk = path.join(root, 'android-sdk');
const output = path.join(root, 'packages/server/assets/sova-android-sdk.zip');
const excluded = new Set(['build', '.gradle', '.kotlin', '.idea', '.cxx', '.git']);
const extensions = new Set(['.kt', '.kts', '.xml', '.md', '.pro', '.properties']);
function collect(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
    .flatMap(entry => {
      if (entry.isSymbolicLink() || excluded.has(entry.name)) return [];
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) return collect(file);
      return entry.isFile() && entry.name !== 'local.properties' &&
        !entry.name.endsWith('.ru.md') && extensions.has(path.extname(file)) ? [file] : [];
    });
}
function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
const entries = collect(sdk).map(file => ({
  name: 'android-sdk/' + path.relative(sdk, file).split(path.sep).join('/'),
  data: fs.readFileSync(file),
}));
entries.push({ name: 'android-sdk/LICENSE', data: fs.readFileSync(path.join(root, 'LICENSE')) });
const chunks = [], directory = [];
let offset = 0;
for (const entry of entries) {
  const name = Buffer.from(entry.name), data = entry.data, crc = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x800, 6); local.writeUInt16LE(33, 12);
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6); central.writeUInt16LE(0x800, 8);
  central.writeUInt16LE(33, 14); central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
  chunks.push(local, name, data); directory.push(central, name);
  offset += local.length + name.length + data.length;
}
const central = Buffer.concat(directory), end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8);
end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(central.length, 12);
end.writeUInt32LE(offset, 16);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, Buffer.concat([...chunks, central, end]));
console.log(`Packaged ${entries.length} source files: packages/server/assets/sova-android-sdk.zip`);
