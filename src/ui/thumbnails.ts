// Builds the "Attachments" thumbnail grid for a prompt's hover card.
//
// Why one SVG instead of several <img> tags? A hover card measures its size
// before images finish loading, so big screenshots overflowed the card and
// overlapped the text. A single SVG with a fixed width and height tells the
// card its exact size up front; the screenshots are drawn inside it, scaled
// down and cropped to fill their tiles. Everything is inline (data: URIs),
// nothing is loaded from anywhere.

const MAX_TILES = 6; // two rows of three
const COLS = 3;
const GAP = 6;
const RADIUS = 4;
const SMALL = { w: 110, h: 72 };  // tile size when there are several images
const SINGLE = { w: 240, h: 150 }; // tile size for a single image

// How many images to load for a prompt with `total` images.
export function imagesToLoad(total: number): number {
  return total <= MAX_TILES ? total : MAX_TILES - 1; // last tile becomes "+N"
}

// `images` are data: URIs; `total` is how many the prompt has in all.
export function thumbnailGrid(images: string[], total: number): { src: string; width: number; height: number } | undefined {
  if (!images.length) return undefined;
  const extra = total - images.length; // shown as a "+N" tile
  const tiles = images.length + (extra > 0 ? 1 : 0);
  const size = tiles === 1 ? SINGLE : SMALL;
  const cols = Math.min(tiles, COLS);
  const rows = Math.ceil(tiles / COLS);
  const width = cols * size.w + (cols - 1) * GAP;
  const height = rows * size.h + (rows - 1) * GAP;

  const parts: string[] = [];
  for (let i = 0; i < tiles; i++) {
    const x = (i % COLS) * (size.w + GAP);
    const y = Math.floor(i / COLS) * (size.h + GAP);
    // Rounded tile outline, shared by the image clip and the frame.
    parts.push(`<clipPath id="c${i}"><rect x="${x}" y="${y}" width="${size.w}" height="${size.h}" rx="${RADIUS}"/></clipPath>`);
    parts.push(`<rect x="${x}" y="${y}" width="${size.w}" height="${size.h}" rx="${RADIUS}" fill="#8882"/>`);
    if (i < images.length) {
      // "slice" = cover the tile, cropping the edges if needed.
      parts.push(
        `<image href="${images[i]}" x="${x}" y="${y}" width="${size.w}" height="${size.h}" preserveAspectRatio="xMidYMid slice" clip-path="url(#c${i})"/>`,
      );
    } else {
      parts.push(
        `<text x="${x + size.w / 2}" y="${y + size.h / 2 + 6}" text-anchor="middle" font-family="sans-serif" font-size="17" font-weight="600" fill="#999">+${extra}</text>`,
      );
    }
    parts.push(`<rect x="${x + 0.5}" y="${y + 0.5}" width="${size.w - 1}" height="${size.h - 1}" rx="${RADIUS}" fill="none" stroke="#8886"/>`);
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join('')}</svg>`;
  return { src: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`, width, height };
}
