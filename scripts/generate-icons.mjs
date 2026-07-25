/**
 * Rasterize assets/comic-book-icon.svg into web + extension PNG sizes.
 * Requires: npm install sharp (devDependency at repo root or run via npx).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const svgPath = path.join(root, 'assets', 'comic-book-icon.svg');
const svg = fs.readFileSync(svgPath);

const outputs = [
  { file: path.join(root, 'web', 'public', 'favicon-32.png'), size: 32 },
  { file: path.join(root, 'web', 'public', 'apple-touch-icon.png'), size: 180 },
  { file: path.join(root, 'extension', 'icons', 'icon16.png'), size: 16 },
  { file: path.join(root, 'extension', 'icons', 'icon48.png'), size: 48 },
  { file: path.join(root, 'extension', 'icons', 'icon128.png'), size: 128 },
];

for (const { file, size } of outputs) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await sharp(svg).resize(size, size).png().toFile(file);
  console.log('wrote', path.relative(root, file));
}

// Multi-size favicon.ico for older browsers.
const icoPath = path.join(root, 'web', 'public', 'favicon.ico');
await sharp(svg)
  .resize(32, 32)
  .png()
  .toFile(icoPath.replace('.ico', '-32.png'));
console.log('wrote web/public/favicon-32.png (use as favicon fallback)');
