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

  // Prefer `output_text` when present.
  const out1 = data?.output_text;
  if (out1 && String(out1).trim()) return String(out1).trim();

  // Fallback: extract text from output[].content[].text
  const out2 = extractTextFromResponses(data);
  if (out2 && out2.trim()) return out2.trim();

  // If still empty, include a small JSON snippet for debugging.
  const snippet = JSON.stringify({
    id: data?.id,
    model: data?.model,
    output: Array.isArray(data?.output) ? data.output.slice(0, 2) : data?.output,
  }).slice(0, 800);
  throw new Error(`OpenAI returned empty output. Debug: ${snippet}`);
}

function extractTextFromResponses(data) {
  try {
    const outputs = Array.isArray(data?.output) ? data.output : [];
    const texts = [];
    for (const o of outputs) {
      const content = Array.isArray(o?.content) ? o.content : [];
      for (const c of content) {
        if (c?.type === 'output_text' && typeof c?.text === 'string') {
          texts.push(c.text);
        } else if (typeof c?.text === 'string') {
          texts.push(c.text);
        }
      }
    }
    return texts.join('').trim();
  } catch {
    return '';
  }
}

async function safeText(resp) {
  try {
    return (await resp.text()).slice(0, 1000);
  } catch {
    return '';
  }
}
