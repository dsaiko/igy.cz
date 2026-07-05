# igy.cz — I Google You

**[www.igy.cz](https://www.igy.cz)** — a privacy‑awareness site that shows visitors, in real time, how much a website silently learns about them the moment they arrive: IP and location, device and browser, a near‑unique fingerprint, and tracking that survives incognito and cookie wipes. No sign‑in, no clicks required.

In the spirit of [BrowserLeaks](https://browserleaks.com), [AmIUnique](https://amiunique.org) and the EFF's *Cover Your Tracks* — but built as a single, dramatic, bilingual (EN/CS) scroll experience.

![igy.cz — I Google You](docs/screenshot.png)

## What it reveals

- **Network** — IP (v4/v6), city, region, country, **ISP / ASN**, Cloudflare edge, HTTP protocol, **TLS version & cipher**, plus a **WebRTC leak** (local IP where not protected by mDNS, and the public IP via STUN) and a **map** pinned to your approximate location.
- **Device** — OS, platform, CPU cores, memory, touch points, screen, DPR, colour depth, **GPU** (via WebGL), a cheeky **device + price guess**, and **the number of cameras & microphones attached — without asking for permission**.
- **Browser** — engine, languages, time zone, locale/number format, Do Not Track, cookies, full User‑Agent.
- **Fingerprint** — canvas, WebGL and audio hashes plus detected fonts, combined into a **near‑unique ID** that stays the same in incognito. Includes an **ETag "supercookie"** that survives clearing cookies, and **software inference from fonts**.
- **Where you really are** — triangulates your country by cross‑checking IP, time zone, language and ad‑blocker signals.
- **Behaviour** — live counters: mouse movement, clicks, keystrokes, scroll depth, and **how many times you switched away** from the tab.
- **Consent‑gated extras** — one click each: precise GPS (with a real map), camera, microphone level, battery.
- **Dossier** — a surveillance‑style summary with an entropy‑based **trackability verdict**.

Everything is computed **in your browser**. The server (two tiny Cloudflare Pages Functions) only reads what the browser sends it — no database, no cookies, nothing stored.

## Tech

- [Astro](https://astro.build) — static output, inlined CSS, self‑contained pages. No client framework; all logic is vanilla inline JS.
- **Cloudflare Pages** + Pages Functions (`functions/api/whoami.js`, `functions/api/etag.js`) — geolocation, ASN and TLS data come free from Cloudflare's edge.
- Bilingual EN/CS via CSS class switching (no i18n library). Default language: **English**; `?lang=cs` / `?lang=en` and a flag switcher override it.

## Local development

Requires Node.js and (for deploy) a Cloudflare account.

```bash
make setup      # npm install
make dev        # astro dev (no CF functions; /api/* falls back)
make preview    # build + wrangler pages dev — runs WITH the functions
make build      # production build → dist/
```

Copy `Makefile.local.example` → `Makefile.local` and set your `CF_ACCOUNT_ID`.

## Deploy

```bash
make login      # one-time Cloudflare OAuth (opens a browser)
make deploy     # build + wrangler pages deploy → Cloudflare Pages
```

Live at **https://www.igy.cz** (apex `igy.cz` 301‑redirects to `www`). Also reachable at `igy-cz.pages.dev`.

## Privacy

igy.cz stores nothing about you. All detection runs client‑side; the server is stateless. The only outbound requests are: your own visit to Cloudflare (unavoidable), a public STUN server for the WebRTC demo, and OpenStreetMap tiles for the location maps.

## License

MIT © Dušan Saiko — part of [saiko.cz](https://www.saiko.cz).
