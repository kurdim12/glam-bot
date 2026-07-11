// OpenRouter client for the agent layer. One entry point, native fetch only.
//
// The model list is a fallback array: OpenRouter tries each slug in order, so
// if the preview model is retired the request silently lands on the stable
// one. Callers treat any throw as "no LLM output" and degrade on their own
// terms — this module never swallows errors itself.

const MODELS = ['google/gemini-3.1-flash-lite-preview', 'google/gemini-2.5-flash-lite'];
const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

/** One chat completion → assistant text. Throws on any failure. */
export async function callLLM(env, { system, user, maxTokens = 400 }) {
  if (!env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY is not set');

  const init = {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      // OpenRouter attribution headers.
      'HTTP-Referer': 'https://www.glambotjo.com',
      'X-Title': 'GLAMBOT',
    },
    body: JSON.stringify({
      models: MODELS,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: maxTokens,
      temperature: 0.3,
    }),
  };

  // One retry on network error or 5xx; 4xx (bad key, bad request) fails fast.
  let res;
  for (let attempt = 0; ; attempt++) {
    try {
      res = await fetch(ENDPOINT, { ...init, signal: AbortSignal.timeout(10000) });
      if (res.status < 500) break;
      if (attempt >= 1) throw new Error(`OpenRouter ${res.status}`);
    } catch (err) {
      if (attempt >= 1) throw err;
    }
  }
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) throw new Error('OpenRouter returned no text');
  return text;
}

/** Parse a model reply that should be bare JSON (tolerating ``` fences). */
export function parseJsonReply(text) {
  let s = String(text).trim();
  const fenced = s.match(/^```[a-zA-Z]*\s*([\s\S]*?)\s*```$/);
  if (fenced) s = fenced[1].trim();
  const parsed = JSON.parse(s); // throws on garbage — caller decides what that means
  if (parsed === null || typeof parsed !== 'object') throw new Error('LLM reply is not a JSON object');
  return parsed;
}
