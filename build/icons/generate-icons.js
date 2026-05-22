// Gera PNG (vários sizes) + ICO a partir do logo.svg.
// Roda: node build/icons/generate-icons.js
const sharp = require('sharp');
const pngToIco = require('png-to-ico').default || require('png-to-ico');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'logo.svg');
const OUT = __dirname;
const SIZES = [16, 24, 32, 48, 64, 128, 256, 512];

(async () => {
  console.log('[icons] gerando PNGs de', SRC);
  const svgBuffer = fs.readFileSync(SRC);
  for (const size of SIZES) {
    const out = path.join(OUT, `icon-${size}.png`);
    await sharp(svgBuffer).resize(size, size).png().toFile(out);
    console.log(`  ✓ icon-${size}.png`);
  }
  // PNG principal pro electron-builder
  await sharp(svgBuffer).resize(512, 512).png().toFile(path.join(OUT, '..', 'icon.png'));
  console.log('  ✓ build/icon.png (512x512)');
  // ICO multi-size pro Windows
  const icoBuffer = await pngToIco([16, 24, 32, 48, 64, 128, 256].map((s) => path.join(OUT, `icon-${s}.png`)));
  fs.writeFileSync(path.join(OUT, '..', 'icon.ico'), icoBuffer);
  console.log('  ✓ build/icon.ico');
  console.log('[icons] feito');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
