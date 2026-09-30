// Jednotkové testy ETag "supercookie" s počítadlem návštěv (functions/api/etag.js).
// Spuštění: npm test   (node:test, žádné závislosti)
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet } from '../functions/api/etag.js';

const realNow = Date.now;
let clock;
beforeEach(() => { clock = Date.UTC(2026, 8, 1, 12, 0, 0); Date.now = () => clock; });
afterEach(() => { Date.now = realNow; });

const sec = (s) => { clock += s * 1000; };
async function call(inm) {
  const headers = inm ? { 'if-none-match': inm } : {};
  const res = onRequestGet({ request: new Request('https://www.igy.cz/api/etag', { headers }) });
  return { etag: res.headers.get('etag'), cacheControl: res.headers.get('cache-control'), body: await res.json() };
}
const b36 = (n) => n.toString(36);
const nowS = () => Math.floor(clock / 1000);

test('první návštěva: nové ID, 1. návštěva, bez minulé', async () => {
  const r = await call(null);
  assert.match(r.body.id, /^igy-[a-z0-9]{12}$/);
  assert.equal(r.body.returning, false);
  assert.equal(r.body.visits, 1);
  assert.equal(r.body.lastVisit, null);
  assert.match(r.cacheControl, /no-cache/);
  assert.match(r.etag, /^"igy-[a-z0-9]{12}\.1\.[0-9a-z]+\.0"$/);
});

test('reload přesně na hranici 30 min = pořád stejná návštěva', async () => {
  const a = await call(null);
  sec(30 * 60);
  const b = await call(a.etag);
  assert.equal(b.body.returning, true);
  assert.equal(b.body.visits, 1);
  assert.equal(b.etag, a.etag);
});

test('30 min + 1 s = nová návštěva, minulá = začátek té předchozí', async () => {
  const a = await call(null); const t0 = nowS();
  sec(30 * 60 + 1);
  const b = await call(a.etag);
  assert.equal(b.body.visits, 2);
  assert.equal(b.body.lastVisit, t0 * 1000);
  assert.equal(b.body.id, a.body.id);
});

test('řetěz návštěv: 3 dny později je to 3. návštěva a minulá se posune', async () => {
  const a = await call(null);
  sec(2 * 3600); const b = await call(a.etag); const t1 = nowS();
  sec(3 * 86400); const c = await call(b.etag);
  assert.equal(c.body.visits, 3);
  assert.equal(c.body.lastVisit, t1 * 1000);
});

test('weak ETag i seznam hodnot v If-None-Match', async () => {
  const a = await call(null);
  sec(3600);
  assert.equal((await call('W/' + a.etag)).body.visits, 2);
  sec(3600);
  const r = await call('"foo", "bar", ' + a.etag);
  assert.equal(r.body.id, a.body.id);
  assert.equal(r.body.returning, true);
});

test('starý formát igy-<id> → vracející se, 2. návštěva, čas neznámý', async () => {
  const r = await call('"igy-abcdef123456"');
  assert.equal(r.body.id, 'igy-abcdef123456');
  assert.equal(r.body.returning, true);
  assert.equal(r.body.visits, 2);
  assert.equal(r.body.lastVisit, null);
});

test('podvržené hodnoty se nepřijmou: budoucnost, obří počet, prevStart > start', async () => {
  const id = 'igy-abcdef123456';
  for (const forged of [
    `${id}.3.${b36(nowS() + 3600)}.0`,               // začátek v budoucnosti
    `${id}.${b36(1e6)}.${b36(nowS())}.0`,             // počet mimo rozsah
    `${id}.3.${b36(nowS() - 100)}.${b36(nowS())}`,    // minulá po současné
  ]) {
    const r = await call('"' + forged + '"');
    assert.equal(r.body.id, id, forged);
    assert.equal(r.body.lastVisit, null, forged);
    assert.equal(r.body.visits, 2, forged);           // bereme jako starý tag bez času
  }
});

test('tolerance 60 s na rozjeté hodiny', async () => {
  const r = await call(`"igy-abcdef123456.4.${b36(nowS() + 30)}.${b36(nowS() - 86400)}"`);
  assert.equal(r.body.visits, 4);                     // stejná návštěva, přijato
  assert.equal(r.body.lastVisit, (nowS() - 86400) * 1000);
});

test('cizí nebo nesmyslný ETag = nový návštěvník', async () => {
  for (const junk of ['"<script>"', '"igy-short"', 'W/"abc"', '*']) {
    const r = await call(junk);
    assert.equal(r.body.returning, false, junk);
    assert.equal(r.body.visits, 1, junk);
  }
});
