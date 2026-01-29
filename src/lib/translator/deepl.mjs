export async function translateWithDeepL({ apiKey, targetLang, text }) {
  if (!apiKey) throw new Error('DeepL apiKey not set');

  // DeepL expects e.g. EN, ZH
  const target = normalizeDeepLTarget(targetLang);

  const params = new URLSearchParams();
  params.set('text', text);
  params.set('target_lang', target);

  const resp = await fetch('https://api-free.deepl.com/v2/translate', {
    method: 'POST',
    headers: {
      authorization: `DeepL-Auth-Key ${apiKey}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: params,
  });

  if (!resp.ok) {
    const body = await safeText(resp);
    throw new Error(`DeepL error ${resp.status}: ${body}`);
  }

  const data = await resp.json();
  const out = data?.translations?.[0]?.text;
  if (!out) throw new Error('DeepL returned empty output');
  return String(out).trim();
}

function normalizeDeepLTarget(lang) {
  const l = String(lang || 'en').toLowerCase();
  if (l.startsWith('en')) return 'EN';
  if (l.startsWith('zh')) return 'ZH';
  if (l.startsWith('ja')) return 'JA';
  if (l.startsWith('ko')) return 'KO';
  if (l.startsWith('de')) return 'DE';
  if (l.startsWith('fr')) return 'FR';
  if (l.startsWith('es')) return 'ES';
  if (l.startsWith('it')) return 'IT';
  if (l.startsWith('pt')) return 'PT';
  if (l.startsWith('ru')) return 'RU';
  if (l.startsWith('nl')) return 'NL';
  // fallback: DeepL will reject unknown codes
  return l.toUpperCase();
}

async function safeText(resp) {
  try {
    return (await resp.text()).slice(0, 1000);
  } catch {
    return '';
  }
}
