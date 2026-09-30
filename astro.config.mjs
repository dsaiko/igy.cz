import { defineConfig } from 'astro/config';

// igy.cz — "I Google You". Statický build, stejný přístup jako saiko.cz/ai:
// ploché .html URL + CSS inline → soběstačný výstup.
// Serverová data (IP, geolokace, ASN) dodává Cloudflare Pages Function
// v ./functions/api/whoami.js — ta se nasadí spolu se statickým /dist.
export default defineConfig({
  // Astro 7 má default 'jsx' (zahazuje zalomení řádku před inline tagem →
  // "složit<b>skoro" slepené). true = původní HTML-aware komprese.
  compressHTML: true,
  build: {
    format: 'file',
    inlineStylesheets: 'always',
  },
});
