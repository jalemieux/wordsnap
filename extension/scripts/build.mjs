// Build the extension with esbuild. Three bundles plus static files.
//   node scripts/build.mjs            production build to dist/
//   node scripts/build.mjs --dev      dev build: sourcemaps, mock provider allowed, local fixture hosts in manifest
//   node scripts/build.mjs --watch    rebuild on change
import * as esbuild from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, 'dist');
const dev = process.argv.includes('--dev');
const watch = process.argv.includes('--watch');

const common = {
  bundle: true,
  target: ['chrome120'],
  sourcemap: dev ? 'inline' : false,
  minify: !dev,
  legalComments: 'none',
  jsx: 'automatic',
  jsxImportSource: 'preact',
  loader: { '.css': 'text', '.md': 'text' },
  define: {
    'process.env.NODE_ENV': JSON.stringify(dev ? 'development' : 'production'),
    '__WORDSNAP_DEV__': JSON.stringify(dev),
  },
  logLevel: 'info',
};

const bundles = [
  { entryPoints: ['src/background/index.ts'], outfile: 'dist/background.js', format: 'esm', platform: 'browser' },
  { entryPoints: ['src/content/index.ts'], outfile: 'dist/content.js', format: 'iife', platform: 'browser' },
  { entryPoints: ['src/options/index.tsx'], outfile: 'dist/options.js', format: 'iife', platform: 'browser' },
];

async function staticFiles() {
  await mkdir(dist, { recursive: true });
  const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
  if (dev) {
    // Let the content script run on the local fixture pages used by the e2e suite.
    const local = ['http://127.0.0.1/*', 'http://localhost/*'];
    manifest.content_scripts[0].matches.push(...local);
    manifest.host_permissions.push(...local);
    manifest.name += ' (dev)';
  }
  await writeFile(path.join(dist, 'manifest.json'), JSON.stringify(manifest, null, 2));
  await cp(path.join(root, 'public'), dist, { recursive: true });
}

await rm(dist, { recursive: true, force: true });
await staticFiles();
const ctxs = await Promise.all(bundles.map((b) => esbuild.context({ ...common, ...b })));
if (watch) {
  await Promise.all(ctxs.map((c) => c.watch()));
  console.log('watching…');
} else {
  await Promise.all(ctxs.map((c) => c.rebuild()));
  await Promise.all(ctxs.map((c) => c.dispose()));
}
