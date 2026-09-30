// Cloudflare Pages Function — GET /api/etag
//
// "Supercookie" přes HTTP ETag: tracking, který přežije smazání cookies.
// Princip: server přiřadí novému návštěvníkovi unikátní ID a pošle ho jako
// ETag. Prohlížeč si ho uloží do cache a při dalším requestu ho sám vrátí
// v hlavičce If-None-Match. Server je tím pádem ÚPLNĚ BEZSTAVOVÝ — nic se
// neukládá, ID "bydlí" v cache prohlížeče.
//
// Do ETagu navíc zakódujeme počet návštěv a čas začátku té minulé → "vítej
// zpět, tohle je tvoje 5. návštěva, minule před 3 dny". Pořád bez databáze:
// celá historie je jen v cache návštěvníka.
//
// Klíč je Cache-Control: no-cache → "kešuj, ale pokaždé se zeptej", takže
// prohlížeč při každém načtení odešle If-None-Match zpět.

// Reload do 30 minut od začátku návštěvy se nepočítá jako nová návštěva.
const VISIT_GAP_S = 30 * 60;

export function onRequestGet({ request }) {
  const now = Math.floor(Date.now() / 1000);
  const prev = parseTag(request.headers.get('if-none-match'), now);

  let tag;
  if (!prev) {
    tag = { id: newId(), visits: 1, start: now, prevStart: 0 };
  } else if (!prev.start || now - prev.start > VISIT_GAP_S) {
    // nová návštěva: ta dosavadní se stává "minulou"
    tag = { id: prev.id, visits: prev.visits + 1, start: now, prevStart: prev.start };
  } else {
    tag = prev; // reload v rámci téže návštěvy
  }

  const body = JSON.stringify({
    id: tag.id,
    returning: !!prev,
    visits: tag.visits,
    lastVisit: tag.prevStart ? tag.prevStart * 1000 : null,
  });
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // Náš ETag = tracking ID + počítadlo. Strong ETag, ať se dobře páruje.
      'etag': '"' + formatTag(tag) + '"',
      // Kešuj, ale pokaždé revaliduj → prohlížeč vždy pošle If-None-Match.
      'cache-control': 'private, no-cache, max-age=0, must-revalidate',
    },
  });
}

// igy-<id>.<visits>.<start>.<prevStart> (čísla v base36; start = unix sekundy)
function formatTag(t) {
  return t.id + '.' + t.visits.toString(36) + '.' + t.start.toString(36) + '.' + t.prevStart.toString(36);
}

// Přijmi ETag z If-None-Match v libovolné podobě (W/"…" i "…", případně víc
// hodnot oddělených čárkou) a vytáhni jen náš formát, ať nereagujeme na
// cizí/proxy ETagy. Starý formát bez počítadla (jen "igy-<id>") bereme jako
// 1 návštěvu s neznámým časem. Hodnoty jsou od klienta → validujeme a
// nesmyslné (budoucnost, obří čísla) zahodíme.
function parseTag(inm, now) {
  if (!inm) return null;
  const matches = inm.match(/"([^"]*)"/g) || [inm];
  for (const raw of matches) {
    const v = raw.replace(/^W\//, '').replace(/"/g, '').trim();
    const m = v.match(/^(igy-[a-z0-9]{6,32})(?:\.([0-9a-z]{1,6})\.([0-9a-z]{1,8})\.([0-9a-z]{1,8}))?$/i);
    if (!m) continue;
    if (!m[2]) return { id: m[1], visits: 1, start: 0, prevStart: 0 };
    const visits = parseInt(m[2], 36), start = parseInt(m[3], 36), prevStart = parseInt(m[4], 36);
    const sane = visits >= 1 && visits < 1e6 && start > 0 && start <= now + 60 && prevStart <= start;
    return sane ? { id: m[1], visits, start, prevStart } : { id: m[1], visits: 1, start: 0, prevStart: 0 };
  }
  return null;
}

function newId() {
  // crypto.randomUUID() je v Cloudflare Workers runtime dostupné.
  const uuid = (crypto && crypto.randomUUID) ? crypto.randomUUID() : fallbackRand();
  return 'igy-' + uuid.replace(/-/g, '').slice(0, 12);
}

function fallbackRand() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}
