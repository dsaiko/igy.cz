// Cloudflare Pages Function — GET /api/whoami
//
// Vrací data, která server vidí, ale klientský JS sám nezjistí: skutečnou IP,
// geolokaci podle IP, operátora/ASN, datacentrum Cloudflare, parametry TLS
// handshake a hlavičky, které prohlížeč posílá. Cloudflare to dává zdarma
// v `request.cf` a v hlavičkách — žádné externí geo API není potřeba.
//
// Vše je read-only, nic se neukládá.

export function onRequestGet({ request }) {
  const cf = request.cf || {};
  const h = request.headers;

  // Hlavičky bereme jmenovitě (ne celý výpis) — to jsou ty zajímavé.
  const headerNames = [
    'user-agent',
    'accept-language',
    'accept-encoding',
    'accept',
    'referer',
    'dnt',
    'sec-gpc',
    'sec-ch-ua',
    'sec-ch-ua-platform',
    'sec-ch-ua-mobile',
    'sec-fetch-site',
    'sec-fetch-mode',
  ];
  const headers = {};
  for (const name of headerNames) {
    const v = h.get(name);
    if (v != null) headers[name] = v;
  }

  const data = {
    ip: h.get('cf-connecting-ip') || h.get('x-real-ip') || null,
    ipVersion: detectIpVersion(h.get('cf-connecting-ip')),

    geo: {
      country: cf.country || null,
      countryName: countryName(cf.country),
      region: cf.region || null,
      regionCode: cf.regionCode || null,
      city: cf.city || null,
      postalCode: cf.postalCode || null,
      latitude: cf.latitude || null,
      longitude: cf.longitude || null,
      timezone: cf.timezone || null,
      continent: cf.continent || null,
      isEU: cf.isEUCountry === '1' || cf.isEUCountry === true || null,
    },

    network: {
      asn: cf.asn || null,
      asOrganization: cf.asOrganization || null,
      colo: cf.colo || null, // Cloudflare datacentrum (kód letiště), kterým jsi prošel
      httpProtocol: cf.httpProtocol || null,
    },

    tls: {
      version: cf.tlsVersion || null,
      cipher: cf.tlsCipher || null,
      clientTcpRtt: cf.clientTcpRtt ?? null, // přibližná latence k Cloudflare v ms
      // JA3 otisk je dostupný jen s Bot Managementem; degraduje na null.
      ja3Hash: (cf.botManagement && cf.botManagement.ja3Hash) || null,
      ja4: (cf.botManagement && cf.botManagement.ja4) || null,
    },

    headers,

    serverTime: new Date().toISOString(),
  };

  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function detectIpVersion(ip) {
  if (!ip) return null;
  return ip.includes(':') ? 6 : 4;
}

// Pár nejčastějších zemí pro hezčí výpis; fallback je samotný kód.
const COUNTRY_NAMES = {
  CZ: { cs: 'Česko', en: 'Czechia' },
  SK: { cs: 'Slovensko', en: 'Slovakia' },
  US: { cs: 'Spojené státy', en: 'United States' },
  GB: { cs: 'Spojené království', en: 'United Kingdom' },
  DE: { cs: 'Německo', en: 'Germany' },
  PL: { cs: 'Polsko', en: 'Poland' },
  AT: { cs: 'Rakousko', en: 'Austria' },
};
function countryName(code) {
  if (!code) return null;
  return COUNTRY_NAMES[code] || { cs: code, en: code };
}
