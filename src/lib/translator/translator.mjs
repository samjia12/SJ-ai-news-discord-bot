import { translateWithOpenAI } from './openai.mjs';
import { translateWithDeepL } from './deepl.mjs';
import { translateWithClaude } from './claude.mjs';

export async function translateText({ provider, apiKey, targetLang, text }) {
  if (!text) return '';

  switch ((provider || '').toLowerCase()) {
    case 'openai':
      return translateWithOpenAI({ apiKey, targetLang, text });
    case 'deepl':
      return translateWithDeepL({ apiKey, targetLang, text });
    case 'claude':
      return translateWithClaude({ apiKey, targetLang, text });
    default:
      throw new Error(`Unknown translator provider: ${provider}`);
  }
}
