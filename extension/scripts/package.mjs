// Produces the zip that goes into the Chrome Web Store dashboard.
// Usage: node scripts/package.mjs   ->  extension/wordsnap-<version>.zip
// Runs a clean production build, checks that nothing from a dev build leaked in, then zips dist/.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
if (manifest.version !== pkg.version) {
  fail(`manifest.json version ${manifest.version} does not match package.json version ${pkg.version}`);
}
for (const size of [16, 32, 48, 128]) {
  await stat(path.join(root, 'public', 'icons', `icon-${size}.png`)).catch(() => fail(`missing public/icons/icon-${size}.png (run node scripts/icons.mjs)`));
}

await rm(dist, { recursive: true, force: true });
execFileSync(process.execPath, [path.join(root, 'scripts', 'build.mjs')], { stdio: 'inherit' });

const built = JSON.parse(await readFile(path.join(dist, 'manifest.json'), 'utf8'));
if (/\(dev\)/.test(built.name)) fail('dist manifest carries the (dev) suffix; this is a dev build');
if (built.key) fail('dist manifest carries a "key"; strip it before uploading to the store');
const bundles = await Promise.all(
  ['background.js', 'content.js', 'options.js'].map((f) => readFile(path.join(dist, f), 'utf8')),
);
for (const marker of ['providers/mock', 'use the mock provider', '127.0.0.1:4173']) {
  if (bundles.some((b) => b.includes(marker))) fail(`dev marker "${marker}" found in the production bundle`);
}

const files = await walk(dist);
const out = path.join(root, `wordsnap-${manifest.version}.zip`);
await writeFile(out, zip(files));
const bytes = (await stat(out)).size;
console.log(`${path.relative(root, out)}  ${files.length} files  ${(bytes / 1024).toFixed(0)} KB`);
console.log(`sha256 ${createHash('sha256').update(await readFile(out)).digest('hex')}`);

function fail(msg) {
  console.error(`package: ${msg}`);
  process.exit(1);
}

async function walk(dir, prefix = '') {
  const entries = [];
  for (const name of (await readdir(dir)).sort()) {
    const full = path.join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if ((await stat(full)).isDirectory()) entries.push(...(await walk(full, rel)));
    else entries.push({ name: rel, data: await readFile(full) });
  }
  return entries;
}

// Minimal zip writer (deflate, no zip64): enough for an extension package, avoids a dependency.
function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const packed = deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // utf-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12); // 1980-01-01 00:01
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, packed);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + packed.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, ...centrals, end]);
}

function crcTable() {
  if (!crcTable.t) {
    crcTable.t = new Uint32Array(256).map((_, n) => {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      return c >>> 0;
    });
  }
  return crcTable.t;
}
function crc32(buf) {
  const table = crcTable();
  let c = 0xffffffff;
  for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
