const sharp = require("sharp");
const path = require("path");

const svgIcon192 = `<svg width="192" height="192" xmlns="http://www.w3.org/2000/svg">
  <rect width="192" height="192" rx="40" fill="#102217"/>
  <circle cx="96" cy="96" r="80" fill="#1a2e22"/>
  <text x="96" y="120" text-anchor="middle" font-size="90" fill="#2bee79" font-family="sans-serif">♪</text>
</svg>`;

const svgIcon512 = `<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" rx="100" fill="#102217"/>
  <circle cx="256" cy="256" r="210" fill="#1a2e22"/>
  <text x="256" y="320" text-anchor="middle" font-size="240" fill="#2bee79" font-family="sans-serif">♪</text>
</svg>`;

const iconsDir = path.join(__dirname, "..", "public", "icons");

sharp(Buffer.from(svgIcon192))
  .png()
  .toFile(path.join(iconsDir, "icon-192x192.png"))
  .then(() => console.log("✓ icon-192x192.png"))
  .catch(console.error);

sharp(Buffer.from(svgIcon512))
  .png()
  .toFile(path.join(iconsDir, "icon-512x512.png"))
  .then(() => console.log("✓ icon-512x512.png"))
  .catch(console.error);
