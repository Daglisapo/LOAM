/**
 * Publishes the two private pages to their secret paths.
 *
 * The guest guide and the owner calendar are protected by unguessable URLs, so
 * those URLs must not sit in version control — nor must the Wi-Fi password the
 * guide prints. Both live as environment variables in Netlify; this step writes
 * the real files at deploy time. The repository stays publishable.
 *
 * Missing variables fall back to obvious development values, so `node build.mjs`
 * works on a fresh clone without any setup.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath rather than slicing the URL by hand: this project lives under a
// path with Greek characters, which arrive percent-encoded in import.meta.url.
const root = dirname(fileURLToPath(import.meta.url));

const GUEST_SLUG    = process.env.GUEST_SLUG    || 'preview-guide';
const ADMIN_SLUG    = process.env.ADMIN_SLUG    || 'preview-admin';
const WIFI_PASSWORD = process.env.WIFI_PASSWORD || 'CHANGE_ME';

if (!process.env.GUEST_SLUG || !process.env.ADMIN_SLUG) {
  console.warn('! GUEST_SLUG / ADMIN_SLUG not set — building at preview paths');
}
if (!process.env.WIFI_PASSWORD) {
  console.warn('! WIFI_PASSWORD not set — the guide will show CHANGE_ME');
}

const pages = [
  { src: 'src/guide.html', out: join('g', GUEST_SLUG, 'index.html') },
  { src: 'src/admin.html', out: join('a', ADMIN_SLUG, 'index.html') },
];

for (const { src, out } of pages) {
  let html = await readFile(join(root, src), 'utf8');
  html = html.replaceAll('__WIFI_PASSWORD__', WIFI_PASSWORD);

  const dest = join(root, out);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, html, 'utf8');
  console.log(`  ${src}  ->  ${out}`);
}

console.log('build complete');
