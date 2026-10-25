// Rebuild with: node brand/source/export.mjs /absolute/path/to/sharp/dist/index.mjs
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sharp = (await import(process.argv[2] || "sharp")).default;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ink = "#171a18",
  teal = "#2f7f6f",
  mint = "#86bdb1";
const { data, info } = await sharp(path.join(root, "source/transparent-master.png"))
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
const W = info.width,
  H = info.height;
const masks = [new Uint8Array(W * H), new Uint8Array(W * H)];
let x0 = W,
  y0 = H,
  x1 = 0,
  y1 = 0;
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) {
    const i = y * W + x,
      j = i * 4;
    if (data[j + 3] < 128) continue;
    const c = data[j + 1] - data[j] > 12 ? 1 : 0;
    masks[c][i] = 1;
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
function simplify(p, e = 1.2) {
  if (p.length < 3) return p;
  const a = p[0],
    b = p.at(-1),
    dx = b[0] - a[0],
    dy = b[1] - a[1],
    d = dx * dx + dy * dy;
  let max = 0,
    k = 0;
  for (let i = 1; i < p.length - 1; i++) {
    const t = d ? Math.max(0, Math.min(1, ((p[i][0] - a[0]) * dx + (p[i][1] - a[1]) * dy) / d)) : 0;
    const z = (p[i][0] - a[0] - t * dx) ** 2 + (p[i][1] - a[1] - t * dy) ** 2;
    if (z > max) {
      max = z;
      k = i;
    }
  }
  return max > e * e
    ? [...simplify(p.slice(0, k + 1), e).slice(0, -1), ...simplify(p.slice(k), e)]
    : [a, b];
}
function trace(mask) {
  const edges = new Map(),
    stride = W + 1;
  const add = (a, b) => {
    if (!edges.has(a)) edges.set(a, []);
    edges.get(a).push(b);
  };
  const at = (x, y) => x >= 0 && y >= 0 && x < W && y < H && mask[y * W + x];
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      if (at(x, y)) {
        const a = y * stride + x,
          b = a + 1,
          d = a + stride,
          c = d + 1;
        if (!at(x, y - 1)) add(a, b);
        if (!at(x + 1, y)) add(b, c);
        if (!at(x, y + 1)) add(c, d);
        if (!at(x - 1, y)) add(d, a);
      }
  const paths = [];
  while (edges.size) {
    const start = edges.keys().next().value;
    let curr = start;
    const p = [];
    do {
      p.push([curr % stride, Math.floor(curr / stride)]);
      const es = edges.get(curr);
      if (!es) break;
      const next = es.pop();
      if (!es.length) edges.delete(curr);
      curr = next;
    } while (curr !== start);
    if (p.length < 20) continue;
    let area = 0;
    for (let i = 0; i < p.length; i++) {
      const a = p[i],
        b = p[(i + 1) % p.length];
      area += a[0] * b[1] - b[0] * a[1];
    }
    if (Math.abs(area) < 30) continue;
    p.push(p[0]);
    const q = simplify(p);
    const v = q.slice(0, -1),
      mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
      fmt = (p) => p.map((n, i) => +(n - (i ? y0 : x0)).toFixed(2)).join(",");
    let curve = "M" + fmt(mid(v.at(-1), v[0]));
    for (let i = 0; i < v.length; i++) {
      const a = v[(i + v.length - 1) % v.length],
        b = v[i],
        c = v[(i + 1) % v.length],
        end = mid(b, c);
      const ux = b[0] - a[0],
        uy = b[1] - a[1],
        vx = c[0] - b[0],
        vy = c[1] - b[1];
      const cosine = (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy));
      const u = Math.min(0.5, 6 / Math.hypot(ux, uy)),
        w = Math.min(0.5, 6 / Math.hypot(vx, vy));
      const enter = [b[0] - ux * u, b[1] - uy * u],
        leave = [b[0] + vx * w, b[1] + vy * w];
      curve +=
        cosine > 0.65
          ? "L" + fmt(enter) + "Q" + fmt(b) + " " + fmt(leave) + "L" + fmt(end)
          : "L" + fmt(b) + "L" + fmt(end);
    }
    paths.push(curve + "Z");
  }
  return paths.join("");
}
const outlines = masks.map(trace),
  lw = x1 - x0 + 1,
  lh = y1 - y0 + 1;
const svg = (w, h, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="PlainBooks">${body}</svg>`;
const mark = (a, b) =>
  `<path fill="${a}" d="M18 0H119Q126 0 131 5L176 49Q180 53 180 60V116H163V61L118 17H20Q17 17 17 21V176Q17 181 22 183L80 210V229L12 199Q0 194 0 180V19Q0 0 18 0Z"/><path fill="${a}" d="M49 55H114A9 9 0 0 1 114 73H49A9 9 0 0 1 49 55ZM49 93H114A9 9 0 0 1 114 111H49A9 9 0 0 1 49 93Z"/><path fill="${b}" d="M92 229V174Q92 129 132 129H180Q180 142 167 156L108 218Q101 226 92 229Z"/>`;
const variants = {
  color: [ink, teal],
  black: [ink, ink],
  white: ["#ffffff", "#ffffff"],
  dark: ["#ffffff", mint],
};
async function save(name, s, widths) {
  await fs.writeFile(path.join(root, name + ".svg"), s);
  for (const width of widths)
    await sharp(Buffer.from(s))
      .resize({ width })
      .png()
      .toFile(path.join(root, `${name}-${width}.png`));
}
for (const [name, [a, b]] of Object.entries(variants)) {
  const body = `<path fill="${a}" fill-rule="evenodd" d="${outlines[0]}"/><path fill="${b}" fill-rule="evenodd" d="${outlines[1]}"/>`;
  await save(
    `logos/plainbooks-${name}`,
    svg(lw + 80, lh + 80, `<g transform="translate(40 40)">${body}</g>`),
    [640, 1280, 2560],
  );
  await save(
    `icons/mark-${name}`,
    svg(256, 256, `<g transform="translate(38 13.5)">${mark(a, b)}</g>`),
    [64, 256, 512],
  );
}
const app = svg(
  512,
  512,
  `<rect width="512" height="512" rx="104" fill="#e3f1ee"/><g transform="translate(121 84) scale(1.5)">${mark(ink, teal)}</g>`,
);
await save("icons/app-icon", app, [192, 512, 1024]);
// Android crops maskable icons to its own shape. Fill the whole square and keep the mark inside the central safe circle (radius 0.4 × size).
const maskable = svg(
  512,
  512,
  `<rect width="512" height="512" fill="#e3f1ee"/><g transform="translate(139 107) scale(1.3)">${mark(ink, teal)}</g>`,
);
await save("icons/app-icon-maskable", maskable, [192, 512]);
await sharp(Buffer.from(app))
  .resize(180)
  .flatten({ background: "#e3f1ee" })
  .png()
  .toFile(path.join(root, "icons/apple-touch-icon.png"));
// Simplified geometry and thicker rules survive 16px rasterization.
const fav = svg(
  32,
  32,
  `<rect width="32" height="32" rx="7" fill="#e3f1ee"/><path d="M20 26H9Q6 26 6 23V8Q6 5 9 5H20L26 11V17H23V12L19 8H9V23H18Z" fill="${ink}"/><path d="M11 12H19V15H11ZM11 17H17V20H11Z" fill="${ink}"/><path d="M20 19H27L20 27Z" fill="${teal}"/>`,
);
await save("icons/favicon", fav, [16, 32, 48]);
const social = svg(
  1200,
  630,
  `<rect width="1200" height="630" fill="#f6f7f5"/><g transform="translate(105 ${315 - (lh * 0.56) / 2}) scale(.56)"><path fill="${ink}" fill-rule="evenodd" d="${outlines[0]}"/><path fill="${teal}" fill-rule="evenodd" d="${outlines[1]}"/></g>`,
);
await save("social/social-card", social, [1200]);
const tiles = [];
for (const [i, name] of ["color", "dark", "black", "white"].entries()) {
  const logo = await sharp(path.join(root, `logos/plainbooks-${name}.svg`))
    .resize({ width: 660 })
    .toBuffer();
  const panel = await sharp({
    create: {
      width: 760,
      height: 250,
      channels: 4,
      background: i === 1 || i === 3 ? ink : "#f6f7f5",
    },
  })
    .composite([{ input: logo, gravity: "center" }])
    .png()
    .toBuffer();
  tiles.push({ input: panel, left: (i % 2) * 760, top: Math.floor(i / 2) * 250 });
}
await sharp({ create: { width: 1520, height: 500, channels: 4, background: "#fff" } })
  .composite(tiles)
  .png()
  .toFile(path.join(root, "preview.png"));
await fs.writeFile(
  path.join(root, "colors.json"),
  JSON.stringify(
    { ink, teal, mint, paper: "#f6f7f5", tint: "#e3f1ee", white: "#ffffff" },
    null,
    2,
  ) + "\n",
);
console.log("Exported logo variants, icons, favicons, social card, and preview.");
