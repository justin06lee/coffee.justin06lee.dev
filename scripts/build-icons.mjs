/**
 * Derive the raster icons from the committed SVG.
 *
 * Everything about this mark is vector and two-tone, so the only reason a PNG
 * exists at all is that Next's `apple-icon` convention refuses SVG — Apple
 * touch icons must be raster. Rather than keep a binary in git that silently
 * drifts from the drawing it came from, the PNG is generated here and ignored
 * by git, so `next build` always emits one that matches the current SVG.
 *
 * The source is the *opaque* variant, not the one served as icon.svg. iOS
 * composites a touch icon onto an unpredictable background and honours no
 * media query, so it needs the black disc baked in and the alpha flattened.
 *
 *   node scripts/build-icons.mjs
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(root, "design/favicon/apple-icon.svg");
const OUT = join(root, "src/app/apple-icon.png");
const SIZE = 180; // what iOS asks for; it downsamples from here itself

let sharp;
try {
  ({ default: sharp } = await import("sharp"));
} catch (err) {
  // Two very different failures land here and they want opposite fixes. Sharp
  // missing from node_modules is one install away; "Could not load the sharp
  // module using the darwin-arm64 runtime" means it is installed and only its
  // platform binary is absent — telling that operator to install again sends
  // them round a loop they have already been round. So lead with what actually
  // threw.
  console.error(
    `build-icons: could not load sharp — ${err?.message ?? err}. It is a ` +
      "devDependency: run the package manager's install if it is missing, or " +
      "reinstall to fetch this platform's binary if it resolved but its " +
      "native binding would not load.",
  );
  process.exit(1);
}

const svg = await readFile(SOURCE);
const png = await sharp(svg, { density: 384 })
  .resize(SIZE, SIZE)
  // No alpha: a transparent touch icon renders as a black hole on some iOS
  // versions and white on others. The disc is already black, so flattening
  // onto black only fills the corners outside it.
  .flatten({ background: "#000000" })
  .png({ compressionLevel: 9, palette: true })
  .toBuffer();

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, png);
console.log(`build-icons: wrote ${OUT} (${SIZE}px, ${png.length} bytes)`);
