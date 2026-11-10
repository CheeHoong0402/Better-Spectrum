// Render every app icon from the approved book mark so the formats stay in sync.
import sharp from 'sharp';
import {fileURLToPath} from 'node:url';

for (const size of [180, 192, 512]) {
  await sharp(fileURLToPath(new URL('../public/icon.svg', import.meta.url)))
    .resize(size, size)
    .png()
    .toFile(fileURLToPath(new URL(`../public/icon-${size}.png`, import.meta.url)));
}
