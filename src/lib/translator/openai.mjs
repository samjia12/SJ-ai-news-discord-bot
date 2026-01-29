export async function translateWithOpenAI({ apiKey, targetLang, text }) {
  if (!apiKey) throw new Error('OpenAI apiKey not set');

  // Minimal, stable translation prompt.
  const system = `You are a professional translator. Translate the user's text into ${targetLang}.\n\nRules:\n- Faithful translation.\n- Do not add commentary.\n- Keep URLs unchanged.\n- Output only the translated text.`;

  const resp = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      input: [
        { role: 'system', content: system },
        { role: 'user', content: text },
      ],
      // keep cost controlled
      max_output_tokens: 400,
    }),
  });

  if (!resp.ok) {
    const body = await safeText(resp);
    throw new Error(`OpenAI error ${resp.status}: ${body}`);
  }

  const data = await resp.json();
  const out = data?.output_text;
  if (!out) throw new Error('OpenAI returned empty output');
  return String(out).trim();
}

async function safeText(resp) {
  try {
    return (await resp.text()).slice(0, 1000);
  } catch {
    return '';
  }
}
