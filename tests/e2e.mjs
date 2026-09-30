// End-to-end kontrola stránky v reálném Chrome (puppeteer-core).
// Spuštění:  npm run build && npm run test:e2e
//   CHROME_PATH=…  cesta k Chrome/Chromium (default: macOS /Applications)
//   E2E_OFFLINE=1  přeskočí jediný test, který jde na síť (GoatCounter + SRI)
//
// Stránka se servíruje z dist/index.html přes request interception; /api/*
// jsou podvržené, ostatní externí requesty se zahazují. Hlídá hlavně to, co
// se v review ukázalo jako křehké: detekci OS/prohlížeče, vypínání kamery a
// mikrofonu, jednorázové volání /api/etag, VPN heuristiku a obsah spisu.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const HTML = fs.readFileSync(ROOT + 'dist/index.html', 'utf8');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OFFLINE = !!process.env.E2E_OFFLINE;
const ORIGIN = 'http://localhost:8093';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const allErrors = [];
const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail });

const WHOAMI = (over = {}) => ({ ip: '203.0.113.7', ipVersion: 4,
  geo: { city: 'Testov', region: 'T', country: 'CZ', countryName: { cs: 'Česko', en: 'Czechia' }, isEU: true,
    latitude: 50.08, longitude: 14.42, timezone: 'Europe/Prague', ...(over.geo || {}) },
  network: { asOrganization: 'TestNet', asn: 64500, colo: 'PRG', httpProtocol: 'HTTP/2', ...(over.network || {}) },
  tls: { version: 'TLSv1.3', cipher: 'AES', clientTcpRtt: 5 } });

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});

async function open(opts = {}) {
  const ctx = opts.defaultContext ? browser.defaultBrowserContext() : await browser.createBrowserContext();
  await ctx.overridePermissions(ORIGIN, ['geolocation', 'camera', 'microphone']);
  const page = await ctx.newPage();
  await page.setViewport(opts.viewport || { width: 1280, height: 900 });
  await page.emulateTimezone(opts.tz || 'Europe/Prague');
  if (opts.ua) await page.setUserAgent(opts.ua);
  if (opts.init) await page.evaluateOnNewDocument(opts.init, opts.initArg);
  page.stats = { etag: 0, errors: [] };
  const onErr = (t) => { page.stats.errors.push(t); allErrors.push(t); };
  page.on('pageerror', (e) => onErr(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED/.test(m.text())) onErr(m.text()); });
  await page.setRequestInterception(true);
  page.on('request', async (req) => {
    const u = req.url();
    if (u.split('?')[0] === ORIGIN + '/') return req.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: HTML });
    if (u.startsWith(ORIGIN + '/api/whoami')) {
      if (opts.whoamiDelay) await sleep(opts.whoamiDelay);
      return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(WHOAMI(opts.whoami)) });
    }
    if (u.startsWith(ORIGIN + '/api/etag')) {
      page.stats.etag++;
      return req.respond({ status: 200, contentType: 'application/json',
        body: JSON.stringify(opts.etag || { id: 'igy-abc', returning: !!req.headers()['if-none-match'], visits: 1, lastVisit: null }) });
    }
    if (u.startsWith('https://nominatim.openstreetmap.org/')) {
      const lat = new URL(u).searchParams.get('lat');
      await sleep(opts.nominatimDelay ? opts.nominatimDelay(lat) : 50);
      return req.respond({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ display_name: 'ADDR ' + lat }) });
    }
    if (u.startsWith('https://gc.zgo.at/') && !OFFLINE) return req.continue();   // skutečná SRI kontrola
    return req.abort();
  });
  await page.goto(ORIGIN + '/?lang=' + (opts.lang || 'en'), { waitUntil: 'domcontentloaded' });
  return page;
}
const close = (p) => (p.browserContext() === browser.defaultBrowserContext() ? p.close() : p.browserContext().close());
async function scrollThrough(page, step = 300) {
  const h = await page.evaluate(() => document.body.scrollHeight);
  for (let y = 0; y <= h; y += step) { await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), y); await sleep(40); }
  await sleep(500);
}
const text = (page, id) => page.$eval('#' + id, (e) => e.textContent.trim()).catch(() => null);
// Zaznamená každý stream z getUserMedia do window.__streams (ať jde zkontrolovat, že skončil).
const TRACK_STREAMS = () => {
  const o = MediaDevices.prototype.getUserMedia;
  MediaDevices.prototype.getUserMedia = function (c) { return o.call(this, c).then((s) => { (window.__streams = window.__streams || []).push(s); return s; }); };
};
const trackStates = (page) => page.evaluate(() => (window.__streams || []).flatMap((s) => s.getTracks()).map((t) => t.readyState));
const allEnded = (st) => st.length > 0 && st.every((t) => t === 'ended');
// Skutečně vidět (computed style + rozměr) — ne jen atribut hidden, ten může CSS přebít.
const visible = (page, id) => page.$eval('#' + id, (e) => getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0);

// ===================== detekce OS / prohlížeče =====================
const IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)';
const MACSAF = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const UAS = [
  ['iPhone Safari', IOS + ' Version/17.5 Mobile/15E148 Safari/604.1', 0, 'iOS / iPadOS', 'Safari'],
  ['iPhone Chrome', IOS + ' CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1', 0, 'iOS / iPadOS', 'Chrome'],
  ['iPhone Firefox', IOS + ' FxiOS/127.0 Mobile/15E148 Safari/605.1.15', 0, 'iOS / iPadOS', 'Firefox'],
  ['iPhone Edge', IOS + ' EdgiOS/126.0.2592.56 Version/17.0 Mobile/15E148 Safari/604.1', 0, 'iOS / iPadOS', 'Edge'],
  ['iPad (desktop UA)', MACSAF, 5, 'iPadOS', 'Safari'],
  ['Mac Safari', MACSAF, 0, 'macOS', 'Safari'],
  ['Mac Chrome', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36', 0, 'macOS', 'Chrome'],
  ['Windows Edge', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0', 0, 'Windows 10/11', 'Edge'],
  ['Android Chrome', 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36', 5, 'Android', 'Chrome'],
  ['Android Edge', 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36 EdgA/126.0.0.0', 5, 'Android', 'Edge'],
];
for (const [name, ua, touch, os, br] of UAS) {
  const page = await open({ ua, init: (t) => { Object.defineProperty(Navigator.prototype, 'maxTouchPoints', { get: () => t }); }, initArg: touch });
  await scrollThrough(page, 400);
  const gotOS = await text(page, 'v-os'), gotBr = await text(page, 'v-browser');
  check(`UA ${name}`, gotOS === os && gotBr === br, `os="${gotOS}" browser="${gotBr}" (want ${os} / ${br})`);
  if (name === 'iPad (desktop UA)') { const g = await text(page, 'v-device-guess'); check('iPad desktop UA → device guess iPad', /^iPad/.test(g || ''), g); }
  await close(page);
}

// ===================== jazyk → země =====================
for (const [lang, want] of [['zh-Hans-CN', 'CN'], ['sr-Latn-RS', 'RS'], ['es-419', null], ['cs', 'CZ'], ['en-US', 'US'], ['de-AT', 'AT']]) {
  const page = await open({ init: (l) => { Object.defineProperty(Navigator.prototype, 'languages', { get: () => [l] }); Object.defineProperty(Navigator.prototype, 'language', { get: () => l }); }, initArg: lang });
  await scrollThrough(page, 400);
  const t = await text(page, 'v-o-lang');
  const m = (t || '').match(/→ \S+ ([A-Z0-9]+)$/);
  check(`language ${lang} → ${want}`, (m ? m[1] : null) === want, t);
  await close(page);
}

// ===================== adblock =====================
for (const [css, want] of [['.adsbox{display:none!important}', '—'], ['.adsbox,.reklama{display:none!important}', 'CZ']]) {
  const page = await open({ init: (c) => { document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = c; document.head.appendChild(s); }); }, initArg: css });
  await scrollThrough(page, 400); await sleep(800);
  const ab = await text(page, 'v-o-adblock'), reg = await text(page, 'v-o-adregion');
  check(`adblock ${css} → region ${want}`, /YES/.test(ab || '') && (want === '—' ? reg === '—' : (reg || '').includes(want)), `adblock="${ab}" region="${reg}"`);
  await close(page);
}

// ===================== /api/etag jen jednou + počítadlo návštěv =====================
{
  const page = await open();
  await sleep(500);
  await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' })); await sleep(1500);
  await page.evaluate(() => window.scrollTo(0, 0)); await scrollThrough(page); await sleep(2000);
  check('/api/etag called exactly once per load', page.stats.etag === 1, `requests=${page.stats.etag}`);
  await close(page);
}

// ===================== hero =====================
{
  const page = await open({ init: () => { navigator.getBattery = () => Promise.resolve(Object.assign(new EventTarget(), { level: 0.43, charging: false, chargingTime: Infinity, dischargingTime: 7200 })); },
    etag: { id: 'igy-abc', returning: true, visits: 5, lastVisit: Date.now() - 3 * 86400e3 } });
  await sleep(6000);
  const f = await text(page, 'hero-facts');
  check('hero chips: city, ISP, device, time, battery, visit', /Testov/.test(f) && /TestNet/.test(f) && /\d{2}:\d{2}/.test(f) && /43 %/.test(f) && /visit #5/.test(f), f);
  check('supercookie: welcome back, visit #5, 3 days ago', /visit #5/.test(await text(page, 'sc-note')) && /3 days ago/.test(await text(page, 'sc-note')), await text(page, 'sc-note'));
  await page.click('.langpill button[data-lang="cs"]'); await sleep(300);
  check('hero chips follow CS switch', /5\. návštěva/.test(await text(page, 'hero-facts')), await text(page, 'hero-facts'));
  await scrollThrough(page);
  check('battery is passive (no click)', /43 %/.test(await text(page, 'v-battery')), await text(page, 'v-battery'));
  await close(page);
}
{
  const page = await open({ whoamiDelay: 4000 });
  await sleep(9000);
  const t = await text(page, 'hero-facts');
  check('hero: whoami after the 2.6 s watchdog still personalises', /Testov/.test(t) && /TestNet/.test(t), t);
  await close(page);
}

// ===================== VPN =====================
{
  const page = await open({ whoami: { network: { asOrganization: 'M247 Europe SRL' }, geo: { timezone: 'America/New_York', city: 'New York' } } });
  await sleep(6500);
  const v = await text(page, 'v-vpn'), sw = await text(page, 'sw-net');
  check('VPN + clock mismatch → caught', /YES \(M247/.test(v) && /Europe\/Prague/.test(sw) && /America\/New_York/.test(sw), `vpn="${v}"`);
  check('hero shows VPN instead of ISP', /VPN · M247/.test(await text(page, 'hero-facts')), await text(page, 'hero-facts'));
  await close(page);
}
for (const [org, tz, name] of [['TestNet', 'Europe/Bratislava', 'same offset zone'], ['Nordic Telecom s.r.o.', 'Europe/Prague', 'Nordic Telecom (Czech ISP)'], ['Nordnet SA', 'Europe/Prague', 'Nordnet']]) {
  const page = await open({ whoami: { network: { asOrganization: org }, geo: { timezone: tz } } });
  await sleep(1500);
  const v = await text(page, 'v-vpn');
  check(`not a VPN: ${name}`, /directly/.test(v), v);
  await close(page);
}

// ===================== klávesnice, anonymní okno =====================
{
  const page = await open({ init: () => {
    Object.defineProperty(navigator, 'keyboard', { value: { getLayoutMap: () => Promise.resolve(new Map([['KeyQ', 'q'], ['KeyY', 'z'], ['Digit2', 'ě'], ['Semicolon', 'ů']])) } });
    Object.defineProperty(Navigator.prototype, 'languages', { get: () => ['en-US'] });
  } });
  await scrollThrough(page); await sleep(800);
  check('keyboard QWERTZ → CZ vote', /QWERTZ.*CZ/.test(await text(page, 'v-o-kbd')), await text(page, 'v-o-kbd'));
  check('report: "type on a Czech keyboard"', /on a Czech keyboard/.test(await text(page, 'ds-story')), '');
  await close(page);
}
for (const def of [false, true]) {
  const page = await open({ defaultContext: def }); await scrollThrough(page);
  const v = await text(page, 'v-incognito');
  check(`incognito row honest in Chromium (${def ? 'regular' : 'off-the-record'})`, /Chrome now hides it/.test(v), v);
  await close(page);
}

// ===================== reveal, kopírování, heatmapa, spis, sdílení =====================
{
  const page = await open({ viewport: { width: 640, height: 260 } });
  await scrollThrough(page, 120);
  const r = await page.$$eval('[data-panel]', (ps) => ps.map((p) => p.classList.contains('in')));
  check('reveal on a 640×260 viewport: every panel', r.every(Boolean), `hidden=${r.filter((x) => !x).length}/${r.length}`);
  await close(page);
}
{
  const page = await open({ init: () => { window.__shared = null; navigator.share = (d) => { window.__shared = d; return Promise.resolve(); }; } });
  await scrollThrough(page);
  await page.$eval('#heat', (e) => e.scrollIntoView({ block: 'center', behavior: 'instant' })); await sleep(400);
  for (let i = 0; i < 60; i++) { await page.mouse.move(300 + i * 6, 300 + Math.sin(i / 5) * 80); await sleep(35); }
  await page.mouse.click(620, 360); await sleep(900);
  const heat = await page.$eval('#heat', (c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let red = 0, amber = 0; for (let i = 0; i < d.length; i += 4) { if (d[i] > d[i + 1] + 40 && d[i] > 60) red++; if (d[i] > 150 && d[i + 1] > 100 && d[i + 2] < 120) amber++; } return { red, amber }; });
  check('heatmap draws trail and click', heat.red > 200 && heat.amber > 10, JSON.stringify(heat));
  await page.evaluate(() => { const r = document.createRange(); r.selectNodeContents(document.querySelectorAll('.sowhat')[1].querySelector('.en')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); document.dispatchEvent(new ClipboardEvent('copy', { bubbles: true })); });
  await sleep(700);
  const toast = await page.$eval('#toast', (t) => t.classList.contains('show') && t.textContent).catch(() => null);
  check('copy: toast + row', /I saw what you copied/.test(toast || '') && /From your hardware/.test(await text(page, 'v-b-copy')), toast);
  const story = await text(page, 'ds-story');
  check('report: device, place, time, duration, copy', /The subject uses/.test(story) && /Testov/.test(story) && /local time/.test(story) && /been here for/.test(story) && /copied/.test(story), story.slice(0, 200));
  const s1 = await text(page, 'ds-story'); await sleep(2100);
  check('report keeps updating', s1 !== (await text(page, 'ds-story')));
  // výběr textu ve spisu musí přežít živou aktualizaci
  await page.evaluate(() => { const r = document.createRange(); r.selectNodeContents(document.getElementById('ds-story')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
  await sleep(2500);
  const sel = await page.evaluate(() => String(getSelection()).length);
  check('selection inside the report survives the live update', sel > 50, `selected chars=${sel}`);
  await page.evaluate(() => getSelection().removeAllRanges());
  await page.$eval('#share-btn', (b) => b.click()); await sleep(300);
  const shared = await page.evaluate(() => window.__shared);
  check('share: Web Share with igy.cz link', shared && shared.url === 'https://www.igy.cz/?lang=en', JSON.stringify(shared));
  const tech = await page.$$eval('details.tech', (d) => d.map((x) => !x.open && x.querySelectorAll('.row').length > 0));
  check('technical details: 4 collapsed blocks', tech.length === 4 && tech.every(Boolean), JSON.stringify(tech));
  check('"so what" line in 6 panels', (await page.$$eval('.sowhat', (p) => p.filter((x) => x.textContent.trim().length > 40).length)) === 6);
  check('"What can you do?" 6 tips', (await page.$$eval('.defend .tip', (t) => t.length)) === 6);
  const unfilled = await page.$$eval('.v', (v) => v.filter((x) => x.textContent.trim() === '…').map((x) => x.id));
  check('no row left at "…"', !unfilled.length, unfilled.join(','));
  await close(page);
}

// ===================== přesná poloha: pozdní odpověď na starší fix =====================
{
  const page = await open({ nominatimDelay: (lat) => (lat.startsWith('10') ? 2500 : 200) });
  await scrollThrough(page, 400);
  await page.setGeolocation({ latitude: 10, longitude: 10 });
  await page.$eval('#perm-geo', (b) => { b.scrollIntoView(); b.click(); }); await sleep(400);
  await page.setGeolocation({ latitude: 20, longitude: 20 });
  await page.$eval('#perm-geo', (b) => b.click()); await sleep(3500);
  const addr = await text(page, 'geo-precise-addr'), loc = await text(page, 'ds-loc');
  check('geo: address belongs to the latest fix', /^ADDR 20/.test(addr) && /ADDR 20/.test(loc), `addr="${addr}" dossier="${loc}"`);
  await close(page);
}

// ===================== kamera =====================
{
  const page = await open({ init: TRACK_STREAMS });
  await scrollThrough(page);
  await page.$eval('#perm-cam', (b) => { b.scrollIntoView(); b.click(); });
  await page.waitForFunction(() => document.getElementById('cam-video').videoWidth > 0, { timeout: 5000 }).catch(() => {});
  const live = { box: await visible(page, 'cam-box'), video: await visible(page, 'cam-video'), still: await visible(page, 'cam-still'), disabled: await page.$eval('#perm-cam', (b) => b.disabled) };
  check('camera: live preview shows video only', live.box && live.video && !live.still && live.disabled, JSON.stringify(live));
  await sleep(3800);
  const after = { video: await visible(page, 'cam-video'), still: await visible(page, 'cam-still'), disabled: await page.$eval('#perm-cam', (b) => b.disabled), cap: await text(page, 'cam-cap') };
  check('camera: after 3 s only the frozen frame, stream off, button back', !after.video && after.still && !after.disabled && allEnded(await trackStates(page)) && /keep this frame/.test(after.cap), JSON.stringify(after));
  await page.click('.langpill button[data-lang="cs"]'); await sleep(200);
  check('camera caption follows CS switch', /snímek by si web mohl nechat/.test(await text(page, 'cam-cap')), await text(page, 'cam-cap'));
  await close(page);
}
{
  const page = await open({ init: TRACK_STREAMS });
  await scrollThrough(page);
  await page.$eval('#perm-cam', (b) => { b.scrollIntoView(); b.click(); });
  await page.waitForFunction(() => (window.__streams || []).length > 0, { timeout: 5000 }).catch(() => {});
  await sleep(300);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide'))); await sleep(200);
  check('camera: pagehide → stop', allEnded(await trackStates(page)), JSON.stringify(await trackStates(page)));
  await close(page);
}
{ // záložka skrytá už ve chvíli, kdy stream dorazí → hned stop, nic se neukáže
  const page = await open({ init: () => {
    const o = MediaDevices.prototype.getUserMedia;
    MediaDevices.prototype.getUserMedia = function (c) { return o.call(this, c).then((s) => {
      (window.__streams = window.__streams || []).push(s);
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      return s; }); };
  } });
  await scrollThrough(page);
  await page.$eval('#perm-cam', (b) => { b.scrollIntoView(); b.click(); }); await sleep(800);
  check('camera: tab already hidden → stops at once, nothing shown', allEnded(await trackStates(page)) && !(await visible(page, 'cam-box')) && !(await page.$eval('#perm-cam', (b) => b.disabled)), JSON.stringify(await trackStates(page)));
  await close(page);
}

// ===================== mikrofon =====================
{
  const page = await open({ init: TRACK_STREAMS });
  await scrollThrough(page);
  await page.$eval('#perm-mic', (b) => { b.scrollIntoView(); b.click(); });
  await page.waitForFunction(() => /level/.test(document.getElementById('pr-mic').textContent), { timeout: 6000 }).catch(() => {});
  const before = await trackStates(page);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  await sleep(400);
  check('mic: tab hidden → stop', before.includes('live') && allEnded(await trackStates(page)), `before=${before}`);
  await close(page);
}
{
  const page = await open({ init: TRACK_STREAMS });
  await scrollThrough(page);
  await page.$eval('#perm-mic', (b) => { b.scrollIntoView(); b.click(); });
  await sleep(9000);
  const pr = await text(page, 'pr-mic');
  check('mic: stops by itself after 8 s', allEnded(await trackStates(page)) && (pr.match(/\(stop\)/g) || []).length === 1, pr);
  await close(page);
}
{
  const page = await open({ init: TRACK_STREAMS });
  await scrollThrough(page);
  await page.$eval('#perm-mic', (b) => { b.scrollIntoView(); b.click(); });
  await page.waitForFunction(() => /level/.test(document.getElementById('pr-mic').textContent), { timeout: 6000 }).catch(() => {});
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide'))); await sleep(200);
  check('mic: pagehide → stop', allEnded(await trackStates(page)));
  await close(page);
}
{
  const page = await open({ init: () => {
    const o = MediaDevices.prototype.getUserMedia; MediaDevices.prototype.getUserMedia = function (c) { return o.call(this, c).then((s) => { (window.__streams = window.__streams || []).push(s); return s; }); };
    window.AudioContext = function () { throw new Error('too many contexts'); }; window.webkitAudioContext = undefined;
  } });
  await scrollThrough(page);
  await page.$eval('#perm-mic', (b) => { b.scrollIntoView(); b.click(); });
  await page.waitForFunction(() => (window.__streams || []).length > 0, { timeout: 5000 }).catch(() => {});
  await sleep(400);
  check('mic: AudioContext throws → stream still stops, button back', allEnded(await trackStates(page)) && /couldn't start/.test(await text(page, 'pr-mic')) && !(await page.$eval('#perm-mic', (b) => b.disabled)), await text(page, 'pr-mic'));
  await close(page);
}

// ===================== mobil =====================
{
  const page = await open({ viewport: { width: 390, height: 844, isMobile: true, hasTouch: true }, lang: 'cs' });
  await sleep(5500); await scrollThrough(page, 250);
  const ov = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  check('mobile 390 px: no horizontal scroll', ov.sw <= ov.iw, JSON.stringify(ov));
  const story = await text(page, 'ds-story');
  check('CS report wording', /Subjekt používá/.test(story) && /Jazyk prohlížeče je/.test(story) && !/zhruba ~/.test(story), story.slice(0, 160));
  await close(page);
}

// ===================== GoatCounter se SRI (síť) =====================
if (!OFFLINE) {
  const page = await open();
  await sleep(3000);
  const gc = await page.evaluate(() => !!(window.goatcounter && typeof window.goatcounter.count === 'function'));
  check('GoatCounter loads with SRI', gc && !page.stats.errors.some((e) => /integrity/i.test(e)), `goatcounter.count=${gc}`);
  await close(page);
}

await browser.close();
check('no JS errors across all pages', !allErrors.length, allErrors.slice(0, 3).join(' | '));
let fail = 0;
for (const r of results) { if (!r.ok) fail++; console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : '  —  ' + String(r.detail).slice(0, 240)}`); }
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
