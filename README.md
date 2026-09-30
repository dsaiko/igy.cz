# igy.cz — I Google You

**[www.igy.cz](https://www.igy.cz)** — a privacy‑awareness site that shows visitors, in real time, how much a website silently learns about them the moment they arrive: IP and location, device and browser, a near‑unique fingerprint, and tracking that survives incognito and cookie wipes. No sign‑in, no clicks required.

In the spirit of [BrowserLeaks](https://browserleaks.com), [AmIUnique](https://amiunique.org) and the EFF's *Cover Your Tracks* — but built as a single, dramatic, bilingual (EN/CS) scroll experience.

![igy.cz — I Google You](docs/screenshot.png)

## What it reveals

- **First screen** — before you scroll: your city, ISP (or VPN), device, local time, battery and visit count, typed out as chips.
- **Network** — IP, city, region, country, **ISP / ASN**, a **VPN check** (VPN/datacenter ASN, and whether your browser clock disagrees with your IP's time zone), a **WebRTC leak** and a **map** pinned to your approximate location. TLS, protocol, Cloudflare edge and connection type are under *technical details*.
- **Device** — best‑guess device **and its price**, OS, **battery** (no prompt in Chromium), CPU, memory, GPU (via WebGL), screen, **number of monitors**, and **how many cameras & microphones are attached — without asking**.
- **Browser** — browser, **incognito check** (honest: Chrome no longer lets sites tell), languages, time zone, local time, **your settings** (dark mode, reduced motion, contrast…), Do Not Track.
- **Fingerprint** — canvas, WebGL and audio hashes plus detected fonts → a **near‑unique ID** that stays the same in incognito, **software inference from fonts**, and an **ETag "supercookie"** that survives a cookie wipe and **counts your visits** ("visit #5, last time 3 days ago") — with no database: the counter lives in your own cache.
- **Where you really are** — triangulates your country from IP, time zone, language, **keyboard layout** and ad‑blocker signals.
- **Behaviour** — live counters (mouse, clicks, keys, scroll depth, tab switches), **what you copied**, and a **heatmap of your cursor** — the view session‑replay tools get.
- **Consent‑gated extras** — one click each: precise GPS (full street address via OpenStreetMap), **camera (3 s live view, then a frozen frame that never leaves your browser)**, microphone level. Streams stop on a timer, when you switch tabs and when you leave.
- **Plugins died. Tracking didn't.** — what Flash/ActiveX/Java/Silverlight did, and what replaced each of them.
- **Dossier** — a surveillance‑style **written report** about you, plus an entropy‑based **trackability verdict**.
- **What can you do?** — honest, short defences (VPN limits, Firefox/Brave/Safari, uBlock Origin, Tor) and a share button.

Each panel ends with one line of *so what* — what the data actually lets a site do.

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
make test       # unit tests (ETag visit counter), no dependencies
make test-e2e   # build + ~60 checks in real Chrome (puppeteer-core)
```

The e2e check needs a local Chrome/Chromium: set `CHROME_PATH` if it isn't in `/Applications`. `E2E_OFFLINE=1` skips the one check that goes to the network (GoatCounter + SRI).

Copy `Makefile.local.example` → `Makefile.local` and set your `CF_ACCOUNT_ID`.

## Deploy

```bash
make login      # one-time Cloudflare OAuth (opens a browser)
make deploy     # build + wrangler pages deploy → Cloudflare Pages
```

Live at **https://www.igy.cz** (apex `igy.cz` 301‑redirects to `www`). Also reachable at `igy-cz.pages.dev`.

## Privacy

igy.cz stores nothing about you. All detection runs client‑side; the server is stateless. The only outbound requests are:

- your own visit to Cloudflare (unavoidable),
- a public STUN server for the WebRTC demo,
- OpenStreetMap tiles for the location maps,
- **only if you grant precise location:** your GPS coordinates to [OpenStreetMap Nominatim](https://nominatim.org) to look up the street address,
- a cookieless page‑view count to [GoatCounter](https://www.goatcounter.com) (honours Do Not Track; the script is pinned with Subresource Integrity).

## License

MIT © Dušan Saiko — part of [saiko.cz](https://www.saiko.cz).
