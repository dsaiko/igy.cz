// Cloudflare Pages Function — GET /api/etag
//
// "Supercookie" přes HTTP ETag: tracking, který přežije smazání cookies.
// Princip: server přiřadí novému návštěvníkovi unikátní ID a pošle ho jako
// ETag. Prohlížeč si ho uloží do cache a při dalším requestu ho sám vrátí
// v hlavičce If-None-Match. Server je tím pádem ÚPLNĚ BEZSTAVOVÝ — nic se
// neukládá, ID "bydlí" v cache prohlížeče.
//
// Klíč je Cache-Control: no-cache → "kešuj, ale pokaždé se zeptej", takže
// prohlížeč při každém načtení odešle If-None-Match zpět.

export function onRequestGet({ request }) {
  const inm = request.headers.get('if-none-match');
  let id = parseId(inm);
  const returning = !!id;
  if (!id) id = newId();

  const body = JSON.stringify({ id, returning });
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // Náš ETag = tracking ID. Strong ETag, ať se dobře páruje.
      'etag': '"' + id + '"',
      // Kešuj, ale pokaždé revaliduj → prohlížeč vždy pošle If-None-Match.
      'cache-control': 'private, no-cache, max-age=0, must-revalidate',
    },
  });
}

// Přijmi ETag z If-None-Match v libovolné podobě (W/"igy-…" i "igy-…",
// případně víc hodnot oddělených čárkou) a vytáhni jen náš formát, ať
// nereagujeme na cizí/proxy ETagy.
function parseId(inm) {
  if (!inm) return null;
  const matches = inm.match(/"([^"]*)"/g) || [inm];
  for (const raw of matches) {
    const v = raw.replace(/^W\//, '').replace(/"/g, '').trim();
    if (/^igy-[a-z0-9]+$/i.test(v)) return v;
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
