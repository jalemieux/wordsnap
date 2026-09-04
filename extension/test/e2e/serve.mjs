// Tiny static server for the e2e fixtures. Serves test/fixtures at http://127.0.0.1:4173/.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT ?? 4173);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const file = path.join(root, url.pathname === '/' ? 'gmail-compose.html' : url.pathname);
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('not found');
  }
}).listen(PORT, '127.0.0.1', () => console.log(`fixtures at http://127.0.0.1:${PORT}/`));
