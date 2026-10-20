// Vercel serverless endpoint: POST /api/chat
// Keeps GROQ_API_KEY on the server and proxies a bounded conversation to Groq.

const GROQ_URL = process.env.GROQ_API_URL || 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'llama-3.3-70b-versatile';

const MAX_MESSAGES = 12; // recent turns sent to the model
const MAX_USER_CHARS = 2000; // per user message
const MAX_ASSISTANT_CHARS = 4000; // older assistant replies are trimmed to this
const MAX_BODY_BYTES = 100 * 1024;
const MAX_OUTPUT_TOKENS = 1024;
const DEFAULT_TIMEOUT_MS = 20000;

const SYSTEM_PROMPT = [
  'You are Orbit, a friendly, capable general-purpose AI assistant.',
  'Answer questions on any topic, explain concepts, write and edit content, brainstorm ideas, and help with follow-up questions.',
  'Use the recent conversation for context. Be clear and concise, and ask a short clarifying question when a request is ambiguous.',
  'Use Markdown sparingly: short paragraphs, lists and fenced code blocks when they help.',
  'If you are not sure about something, say so rather than guessing.',
].join(' ');

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  // Vercel pre-parses JSON bodies; fall back to reading the stream (local dev, tests).
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') {
      try { return Promise.resolve(JSON.parse(req.body)); } catch { return Promise.resolve(null); }
    }
    return Promise.resolve(typeof req.body === 'object' ? req.body : null);
  }
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) { resolve(null); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { resolve(null); }
    });
    req.on('error', () => resolve(null));
  });
}

// Returns { messages } or { error }.
function cleanMessages(input) {
  if (!Array.isArray(input) || input.length === 0) return { error: 'Please send at least one message.' };
  const cleaned = [];
  for (const m of input.slice(-MAX_MESSAGES)) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') continue;
    const content = m.content.trim();
    if (!content) continue;
    cleaned.push({ role: m.role, content });
  }
  const last = cleaned[cleaned.length - 1];
  if (!last || last.role !== 'user') return { error: 'The last message must come from the user.' };
  if (last.content.length > MAX_USER_CHARS) {
    return { error: `Messages are limited to ${MAX_USER_CHARS} characters.` };
  }
  for (const m of cleaned) {
    const cap = m.role === 'user' ? MAX_USER_CHARS : MAX_ASSISTANT_CHARS;
    if (m.content.length > cap) m.content = m.content.slice(0, cap);
  }
  return { messages: cleaned };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { error: 'Method not allowed.' });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.error('GROQ_API_KEY is not set.');
    return send(res, 500, { error: 'Orbit is not configured yet. The server is missing its API key.' });
  }

  const body = await readBody(req);
  if (!body || typeof body !== 'object') return send(res, 400, { error: 'Invalid request.' });

  const { messages, error } = cleanMessages(body.messages);
  if (error) return send(res, 400, { error });

  const model = (process.env.GROQ_MODEL || '').trim() || DEFAULT_MODEL;
  const timeoutMs = Number(process.env.GROQ_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const upstream = await fetch(GROQ_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
        temperature: 0.7,
        max_tokens: MAX_OUTPUT_TOKENS,
        stream: false,
      }),
    });

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => '');
      console.error(`Groq responded ${upstream.status}: ${detail.slice(0, 500)}`);
      if (upstream.status === 429) return send(res, 429, { error: 'Orbit is getting a lot of requests. Please try again in a moment.' });
      if (upstream.status === 401 || upstream.status === 403) return send(res, 502, { error: 'Orbit could not authenticate with its AI provider. Check the server API key.' });
      if (upstream.status === 404 || upstream.status === 400) return send(res, 502, { error: 'The AI provider rejected the request. Check the configured model name.' });
      return send(res, 502, { error: 'The AI provider had a problem. Please try again.' });
    }

    const data = await upstream.json();
    const reply = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (typeof reply !== 'string' || !reply.trim()) {
      return send(res, 502, { error: 'Orbit got an empty answer. Please try again.' });
    }
    return send(res, 200, { reply: reply.trim() });
  } catch (err) {
    if (err && err.name === 'AbortError') return send(res, 504, { error: 'That took too long. Please try again.' });
    console.error('Groq request failed:', err && err.message);
    return send(res, 502, { error: 'Could not reach the AI provider. Please try again.' });
  } finally {
    clearTimeout(timer);
  }
};
