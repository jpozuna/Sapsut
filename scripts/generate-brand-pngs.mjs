import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = process.cwd();
const imagesDir = path.join(root, 'assets', 'images');

const inputs = {
  logo: path.join(imagesDir, 'Sapsut-Logo.svg'),
  favicon: path.join(imagesDir, 'Sapsut-favicon.svg'),
};

async function ensureExists(filePath) {
  try {
    await fs.access(filePath);
  } catch {
    throw new Error(`Missing file: ${filePath}`);
  }
}

function out(name) {
  return path.join(imagesDir, name);
}

async function svgToPng({ inputSvg, outputPng, width, height, background }) {
  const s = sharp(inputSvg, { density: 300 });
  const resized = s.resize(width, height, {
    fit: 'contain',
    background: background ?? { r: 0, g: 0, b: 0, alpha: 0 },
  });
  await resized.png().toFile(outputPng);
}

async function solidPng({ outputPng, width, height, color }) {
  await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: color,
    },
  })
    .png()
    .toFile(outputPng);
}

async function main() {
  await ensureExists(inputs.logo);
  await ensureExists(inputs.favicon);

  // App icon (Expo expects a raster image here)
  await svgToPng({
    inputSvg: inputs.favicon,
    outputPng: out('sapsut-icon-1024.png'),
    width: 1024,
    height: 1024,
  });

  // Splash image (kept wide like the wordmark)
  await svgToPng({
    inputSvg: inputs.logo,
    outputPng: out('sapsut-splash-800x400.png'),
    width: 800,
    height: 400,
  });

  // In-app logo image (used in headers)
  await svgToPng({
    inputSvg: inputs.logo,
    outputPng: out('sapsut-logo-800x360.png'),
    width: 800,
    height: 360,
  });

  // Android adaptive icon assets
  await svgToPng({
    inputSvg: inputs.favicon,
    outputPng: out('sapsut-adaptive-foreground-1024.png'),
    width: 1024,
    height: 1024,
  });
  await solidPng({
    outputPng: out('sapsut-adaptive-background-1024.png'),
    width: 1024,
    height: 1024,
    color: '#E6F4FE',
  });

  console.log('Generated brand PNGs in assets/images/');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
