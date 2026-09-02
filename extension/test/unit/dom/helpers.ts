import { readFileSync } from 'node:fs';
import path from 'node:path';

export function loadFixture(name: string): void {
  const html = readFileSync(path.join(process.cwd(), 'test/fixtures', name), 'utf8');
  const hostMatch = html.match(/data-wordsnap-host="([a-z]+)"/);
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/);
  document.documentElement.removeAttribute('data-wordsnap-host');
  if (hostMatch) document.documentElement.setAttribute('data-wordsnap-host', hostMatch[1]!);
  document.body.innerHTML = bodyMatch ? bodyMatch[1]! : html;
}
