import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || 8787);
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const DEFAULT_MODEL = process.env.MODEL || 'llama3.2:3b';

const app = express();
app.use(express.json({ limit: '1mb' }));

/* the PWA may be served from another origin (e.g. a public deployment) and
   point back at this machine, so the API is cross-origin friendly */
app.use('/api', (req, res, next) => {
  res.setHeader('access-control-allow-origin', req.headers.origin ?? '*');
  res.setHeader('access-control-allow-headers', 'content-type');
  res.setHeader('vary', 'origin');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

app.get('/api/health', async (_req, res) => {
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`);
    const data = await r.json();
    res.json({ ok: true, defaultModel: DEFAULT_MODEL, models: data.models?.map((m) => m.name) ?? [] });
  } catch (err) {
    res.status(503).json({ ok: false, error: String(err) });
  }
});

app.post('/api/chat', async (req, res) => {
  const { messages, model, system } = req.body ?? {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages[] required' });
  }

  const payload = {
    model: model || DEFAULT_MODEL,
    stream: true,
    messages: system ? [{ role: 'system', content: system }, ...messages] : messages,
  };

  const controller = new AbortController();
  res.on('close', () => controller.abort());

  let upstream;
  try {
    upstream = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (err) {
    return res.status(502).json({ error: `cannot reach model backend: ${err}` });
  }

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => '');
    return res.status(502).json({ error: text || 'model backend error' });
  }

  res.setHeader('content-type', 'text/event-stream');
  res.setHeader('cache-control', 'no-cache, no-transform');
  res.setHeader('connection', 'keep-alive');
  res.flushHeaders?.();

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        let chunk;
        try {
          chunk = JSON.parse(line);
        } catch {
          continue;
        }
        const token = chunk.message?.content ?? '';
        if (token) res.write(`data: ${JSON.stringify({ token })}\n\n`);
        if (chunk.done) res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      }
    }
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: String(err) })}\n\n`);
  } finally {
    res.end();
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`JARVIS PWA on http://localhost:${PORT} (model backend: ${OLLAMA_URL})`);
});
