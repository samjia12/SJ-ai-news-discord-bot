export async function translateWithClaude({ apiKey, targetLang, text }) {
  if (!apiKey) throw new Error('Claude apiKey not set');

  const system = `Translate the user's text into ${targetLang}.\n\nRules:\n- Faithful translation.\n- Do not add commentary.\n- Keep URLs unchanged.\n- Output only the translated text.`;

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-3-5-haiku-latest',
      max_tokens: 500,
      system,
      messages: [{ role: 'user', content: text }],
    }),
  });

  if (!resp.ok) {
    const body = await safeText(resp);
    throw new Error(`Claude error ${resp.status}: ${body}`);
  }

  const data = await resp.json();
  const out = data?.content?.map((c) => c?.text || '').join('').trim();
  if (!out) throw new Error('Claude returned empty output');
  return out;
}

async function safeText(resp) {
  try {
    return (await resp.text()).slice(0, 1000);
  } catch {
    return '';
  }
}
