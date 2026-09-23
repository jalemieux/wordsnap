// The playground: WordSnap's background and content script running in an ordinary web page, no extension load.
//   node scripts/playground.mjs          build, watch, serve at http://127.0.0.1:8765/ and reload open pages on rebuild
//   PORT=9000 node scripts/playground.mjs
// Serves the e2e fixture composers (test/fixtures) with the playground bundle appended, and the settings page with
// its own bundle. Output goes to .playground/ (gitignored). Production builds are untouched.
import * as esbuild from 'esbuild';
import { createServer } from 'node:http';
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, '.playground');
const fixtures = path.join(root, 'test', 'fixtures');
const publicDir = path.join(root, 'public');
const PORT = Number(process.env.PORT ?? 8765);

const FIXTURES = {
  gmail: 'gmail-compose.html',
  x: 'x-composer.html',
  linkedin: 'linkedin-share.html',
  'any-site': 'any-site.html',
};

// Live reload: every open playground page holds an SSE stream; a finished rebuild pings them all.
const clients = new Set();
const notifyReload = () => {
  for (const res of clients) res.write('event: reload\ndata: 1\n\n');
};

const reloadPlugin = {
  name: 'playground-reload',
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length) return;
      console.log(`[playground] rebuilt ${new Date().toLocaleTimeString()}`);
      notifyReload();
    });
  },
};

const common = {
  bundle: true,
  target: ['chrome120'],
  sourcemap: 'inline',
  minify: false,
  legalComments: 'none',
  jsx: 'automatic',
  jsxImportSource: 'preact',
  loader: { '.css': 'text', '.md': 'text' },
  define: {
    'process.env.NODE_ENV': JSON.stringify('development'),
    '__WORDSNAP_DEV__': 'true',
    '__WORDSNAP_BROWSER__': JSON.stringify('chrome'),
  },
  logLevel: 'warning',
  format: 'iife',
  platform: 'browser',
  plugins: [reloadPlugin],
};

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
const ctx = await esbuild.context({
  ...common,
  entryPoints: { playground: 'src/playground/index.ts', 'playground-options': 'src/playground/options.ts' },
  outdir: out,
});
await ctx.watch();

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

function indexPage() {
  const links = Object.keys(FIXTURES)
    .map((slug) => `<li><a href="/${slug}">${slug}</a></li>`)
    .join('');
  return `<!doctype html><meta charset="utf-8"><title>WordSnap playground</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:640px;margin:48px auto;padding:0 24px;color:#1f2a2e}code{background:#eef2f3;padding:1px 4px;border-radius:3px}</style>
<h1>WordSnap playground</h1>
<p>The background and the content script run in the page itself over an in-page <code>chrome</code> shim. No extension load, no reload cycle: edit a source file and the open page reloads.</p>
<ul>${links}<li><a href="/options">options page</a></li></ul>
<p>The strip at the bottom left picks the provider (mock or an OpenRouter key kept in this browser's localStorage), loads a sample draft and shows the session state the background sends. What is missing versus the real extension: the toolbar popup, one-click sign-in and per-site permissions.</p>`;
}

async function serveFile(res, file) {
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
  const p = url.pathname;
  const html = (body) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(body);
  };
  if (p === '/') return html(indexPage());
  if (p === '/__reload') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.write('retry: 500\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  const slug = p.replace(/^\/+|\/+$/g, '');
  if (FIXTURES[slug]) {
    const page = await readFile(path.join(fixtures, FIXTURES[slug]), 'utf8');
    return html(page.replace(/<\/body>/i, '<script src="/playground.js"></script></body>'));
  }
  if (slug === 'options') {
    const page = await readFile(path.join(publicDir, 'options.html'), 'utf8');
    return html(page.replace('src="options.js"', 'src="/playground-options.js"'));
  }
  if (p === '/playground.js' || p === '/playground-options.js') return serveFile(res, path.join(out, p.slice(1)));
  if (p.startsWith('/icons/')) return serveFile(res, path.join(publicDir, p.slice(1)));
  res.writeHead(404);
  res.end('not found');
}).listen(PORT, '127.0.0.1', () => {
  console.log(`[playground] http://127.0.0.1:${PORT}/  (gmail, x, linkedin, any-site, options)`);
});
