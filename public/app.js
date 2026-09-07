const DEFAULT_SYSTEM =
  'You are JARVIS, a concise, capable and slightly witty AI assistant in the style of a personal butler. ' +
  'Answer directly and helpfully. Use markdown code blocks for code. Keep spoken answers reasonably short.';

const $ = (id) => document.getElementById(id);
const els = {
  messages: $('messages'),
  input: $('input'),
  composer: $('composer'),
  sendBtn: $('sendBtn'),
  stopBtn: $('stopBtn'),
  micBtn: $('micBtn'),
  chatList: $('chatList'),
  newChat: $('newChat'),
  clearBtn: $('clearBtn'),
  menuBtn: $('menuBtn'),
  sidebar: $('sidebar'),
  modelSelect: $('modelSelect'),
  modelBadge: $('modelBadge'),
  ttsToggle: $('ttsToggle'),
  wakeToggle: $('wakeToggle'),
  systemPrompt: $('systemPrompt'),
  statusDot: $('statusDot'),
  statusText: $('statusText'),
  installBtn: $('installBtn'),
  offlineBar: $('offlineBar'),
  backdrop: $('backdrop'),
};

const isNarrow = () => window.matchMedia('(max-width: 900px)').matches;

function setSidebar(open) {
  els.sidebar.classList.toggle('open', open);
  els.backdrop.hidden = !open;
  requestAnimationFrame(() => els.backdrop.classList.toggle('show', open));
}

/* ---------------- state ---------------- */

const store = {
  load(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  },
  save(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  },
};

const state = {
  chats: store.load('jarvis.chats', []),
  activeId: store.load('jarvis.active', null),
  settings: store.load('jarvis.settings', { model: '', tts: true, wake: false, system: DEFAULT_SYSTEM }),
  streaming: false,
  abort: null,
};

function activeChat() {
  return state.chats.find((c) => c.id === state.activeId);
}

function newChat() {
  const chat = { id: crypto.randomUUID(), title: 'New conversation', messages: [], updated: Date.now() };
  state.chats.unshift(chat);
  state.activeId = chat.id;
  persist();
  renderChatList();
  renderMessages();
  return chat;
}

function persist() {
  store.save('jarvis.chats', state.chats.slice(0, 50));
  store.save('jarvis.active', state.activeId);
  store.save('jarvis.settings', state.settings);
}

/* ---------------- rendering ---------------- */

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function renderMarkdown(text) {
  const parts = text.split(/```/);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) {
        const body = part.replace(/^[a-zA-Z0-9+#-]*\n/, '');
        return `<pre><code>${escapeHtml(body)}</code></pre>`;
      }
      return escapeHtml(part)
        .replace(/`([^`\n]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    })
    .join('');
}

function messageEl(role, content, { streaming = false, error = false } = {}) {
  const wrap = document.createElement('div');
  wrap.className = `msg ${role}${error ? ' error' : ''}`;
  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.textContent = role === 'user' ? 'YOU' : 'J';
  const bubble = document.createElement('div');
  bubble.className = 'bubble' + (streaming ? ' cursor' : '');
  bubble.innerHTML = renderMarkdown(content);
  wrap.append(avatar, bubble);
  return { wrap, bubble };
}

function renderMessages() {
  const chat = activeChat();
  els.messages.innerHTML = '';
  if (!chat || chat.messages.length === 0) {
    els.messages.append(heroNode());
    return;
  }
  for (const m of chat.messages) {
    els.messages.append(messageEl(m.role, m.content, { error: m.error }).wrap);
  }
  els.messages.scrollTop = els.messages.scrollHeight;
}

function heroNode() {
  const div = document.createElement('div');
  div.className = 'hero';
  div.innerHTML = `
    <div class="orb"></div>
    <h1>Good day. I am JARVIS.</h1>
    <p>Ask me anything by text or voice. Everything runs locally on your machine.</p>
    <div class="suggestions">
      <button class="chip">Summarise the last week in AI</button>
      <button class="chip">Write a Python script to rename files</button>
      <button class="chip">Explain quantum tunnelling simply</button>
      <button class="chip">Draft a polite follow-up email</button>
    </div>`;
  return div;
}

function renderChatList() {
  els.chatList.innerHTML = '';
  for (const chat of state.chats) {
    const item = document.createElement('div');
    item.className = 'chat-item' + (chat.id === state.activeId ? ' active' : '');
    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = chat.title;
    const del = document.createElement('button');
    del.className = 'del';
    del.textContent = '✕';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      state.chats = state.chats.filter((c) => c.id !== chat.id);
      if (state.activeId === chat.id) state.activeId = state.chats[0]?.id ?? null;
      if (!state.activeId) newChat();
      persist();
      renderChatList();
      renderMessages();
    });
    item.append(title, del);
    item.addEventListener('click', () => {
      state.activeId = chat.id;
      persist();
      renderChatList();
      renderMessages();
      setSidebar(false);
    });
    els.chatList.append(item);
  }
}

/* ---------------- chat ---------------- */

async function send(text) {
  const content = text.trim();
  if (!content || state.streaming) return;

  const chat = activeChat() ?? newChat();
  chat.messages.push({ role: 'user', content });
  if (chat.title === 'New conversation') chat.title = content.slice(0, 40);
  chat.updated = Date.now();
  persist();
  renderChatList();

  els.messages.querySelector('.hero')?.remove();
  els.messages.append(messageEl('user', content).wrap);

  const { wrap, bubble } = messageEl('assistant', '', { streaming: true });
  els.messages.append(wrap);
  els.messages.scrollTop = els.messages.scrollHeight;

  setStreaming(true);
  state.abort = new AbortController();
  let reply = '';
  let spokenUpTo = 0;

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: state.abort.signal,
      body: JSON.stringify({
        model: state.settings.model || undefined,
        system: state.settings.system || DEFAULT_SYSTEM,
        messages: chat.messages.map(({ role, content }) => ({ role, content })),
      }),
    });

    if (!res.ok || !res.body) throw new Error((await res.text()) || `HTTP ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop() ?? '';
      for (const evt of events) {
        const line = evt.split('\n').find((l) => l.startsWith('data: '));
        if (!line) continue;
        const data = JSON.parse(line.slice(6));
        if (data.error) throw new Error(data.error);
        if (data.token) {
          reply += data.token;
          bubble.innerHTML = renderMarkdown(reply);
          els.messages.scrollTop = els.messages.scrollHeight;
          if (state.settings.tts) spokenUpTo = speakSentences(reply, spokenUpTo);
        }
      }
    }

    if (state.settings.tts) speakSentences(reply, spokenUpTo, true);
    chat.messages.push({ role: 'assistant', content: reply });
  } catch (err) {
    if (err.name === 'AbortError') {
      if (reply) chat.messages.push({ role: 'assistant', content: reply });
    } else {
      const msg = `⚠ ${err.message}`;
      bubble.innerHTML = renderMarkdown(msg);
      wrap.classList.add('error');
      chat.messages.push({ role: 'assistant', content: msg, error: true });
    }
  } finally {
    bubble.classList.remove('cursor');
    chat.updated = Date.now();
    persist();
    setStreaming(false);
    state.abort = null;
    if (state.settings.wake) startWakeListening();
  }
}

function setStreaming(on) {
  state.streaming = on;
  els.sendBtn.hidden = on;
  els.stopBtn.hidden = !on;
}

/* ---------------- speech ---------------- */

function speakSentences(fullText, from, flush = false) {
  if (!('speechSynthesis' in window)) return from;
  const pending = fullText.slice(from);
  const boundary = pending.lastIndexOf('. ');
  const cut = flush ? pending.length : boundary >= 0 ? boundary + 1 : -1;
  if (cut <= 0) return from;
  const chunk = pending.slice(0, cut).replace(/```[\s\S]*?```/g, ' code block ').trim();
  if (chunk) {
    const u = new SpeechSynthesisUtterance(chunk);
    u.rate = 1.05;
    u.pitch = 0.9;
    const voice = speechSynthesis.getVoices().find((v) => /en-GB|Daniel|Google UK English Male/i.test(v.name + v.lang));
    if (voice) u.voice = voice;
    speechSynthesis.speak(u);
  }
  return from + cut;
}

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let mode = 'idle'; // idle | dictate | wake

function makeRecognition() {
  if (!SR) return null;
  const r = new SR();
  r.lang = 'en-US';
  r.interimResults = true;
  r.continuous = true;
  return r;
}

function stopRecognition() {
  mode = 'idle';
  els.micBtn.classList.remove('listening', 'wake');
  try {
    recognition?.stop();
  } catch {}
  recognition = null;
}

function startDictation() {
  if (!SR) {
    alert('Speech recognition is not supported in this browser. Chrome or Edge is recommended.');
    return;
  }
  stopRecognition();
  speechSynthesis.cancel();
  recognition = makeRecognition();
  mode = 'dictate';
  els.micBtn.classList.add('listening');
  let finalText = '';

  recognition.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) finalText += t;
      else interim += t;
    }
    els.input.value = (finalText + interim).trim();
    autosize();
  };
  recognition.onerror = () => stopRecognition();
  recognition.onend = () => {
    if (mode !== 'dictate') return;
    stopRecognition();
    const text = els.input.value.trim();
    if (text) {
      els.input.value = '';
      autosize();
      send(text);
    }
  };
  recognition.start();
}

function startWakeListening() {
  if (!SR || !state.settings.wake || state.streaming) return;
  stopRecognition();
  recognition = makeRecognition();
  mode = 'wake';
  els.micBtn.classList.add('wake');
  recognition.onresult = (e) => {
    const last = e.results[e.results.length - 1];
    const text = last[0].transcript.toLowerCase();
    if (!last.isFinal || !text.includes('jarvis')) return;
    const command = text.split('jarvis').pop().trim();
    if (command.length > 1) {
      stopRecognition();
      send(command);
    }
  };
  recognition.onerror = () => {
    if (mode === 'wake') setTimeout(startWakeListening, 1500);
  };
  recognition.onend = () => {
    if (mode === 'wake') setTimeout(startWakeListening, 400);
  };
  try {
    recognition.start();
  } catch {}
}

/* ---------------- wiring ---------------- */

function autosize() {
  const max = Math.min(180, Math.round(window.innerHeight * 0.3));
  els.input.style.height = 'auto';
  const needed = els.input.scrollHeight;
  els.input.style.height = Math.min(needed, max) + 'px';
  els.input.style.overflowY = needed > max ? 'auto' : 'hidden';
}

/* keep the composer above the on-screen keyboard */
if (window.visualViewport) {
  const vv = window.visualViewport;
  const syncViewport = () => {
    const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    document.documentElement.style.setProperty('--kb-inset', `${inset}px`);
  };
  vv.addEventListener('resize', syncViewport);
  vv.addEventListener('scroll', syncViewport);
  syncViewport();
}

els.composer.addEventListener('submit', (e) => {
  e.preventDefault();
  if (isNarrow()) els.input.blur();
  const text = els.input.value;
  els.input.value = '';
  autosize();
  send(text);
});

els.input.addEventListener('input', autosize);
els.input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !isNarrow()) {
    e.preventDefault();
    els.composer.requestSubmit();
  }
});

els.stopBtn.addEventListener('click', () => {
  state.abort?.abort();
  speechSynthesis.cancel();
});

els.micBtn.addEventListener('click', () => {
  if (mode === 'dictate') stopRecognition();
  else startDictation();
});

els.newChat.addEventListener('click', () => {
  newChat();
  setSidebar(false);
});

els.clearBtn.addEventListener('click', () => {
  const chat = activeChat();
  if (!chat) return;
  chat.messages = [];
  chat.title = 'New conversation';
  persist();
  renderChatList();
  renderMessages();
});

els.menuBtn.addEventListener('click', () => setSidebar(!els.sidebar.classList.contains('open')));
els.backdrop.addEventListener('click', () => setSidebar(false));
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') setSidebar(false);
});
window.addEventListener('resize', () => {
  if (!isNarrow()) setSidebar(false);
  autosize();
});

els.messages.addEventListener('click', (e) => {
  if (e.target.classList.contains('chip')) send(e.target.textContent);
});

els.ttsToggle.addEventListener('change', () => {
  state.settings.tts = els.ttsToggle.checked;
  if (!state.settings.tts) speechSynthesis.cancel();
  persist();
});

els.wakeToggle.addEventListener('change', () => {
  state.settings.wake = els.wakeToggle.checked;
  persist();
  if (state.settings.wake) startWakeListening();
  else stopRecognition();
});

els.systemPrompt.addEventListener('change', () => {
  state.settings.system = els.systemPrompt.value;
  persist();
});

els.modelSelect.addEventListener('change', () => {
  state.settings.model = els.modelSelect.value;
  els.modelBadge.textContent = state.settings.model;
  persist();
});

/* health + models */
async function refreshHealth() {
  try {
    const res = await fetch('/api/health');
    const data = await res.json();
    if (!data.ok) throw new Error('backend down');
    els.statusDot.className = 'dot online';
    els.statusText.textContent = 'local model online';
    els.modelSelect.innerHTML = '';
    for (const name of data.models) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      els.modelSelect.append(opt);
    }
    if (!state.settings.model || !data.models.includes(state.settings.model)) {
      state.settings.model = data.models.includes(data.defaultModel) ? data.defaultModel : data.models[0] ?? '';
      persist();
    }
    els.modelSelect.value = state.settings.model;
    els.modelBadge.textContent = state.settings.model || 'no model';
  } catch {
    els.statusDot.className = 'dot offline';
    els.statusText.textContent = 'model backend unreachable';
    els.modelBadge.textContent = 'offline';
  }
}

function updateOnline() {
  els.offlineBar.hidden = navigator.onLine;
}
window.addEventListener('online', () => {
  updateOnline();
  refreshHealth();
});
window.addEventListener('offline', updateOnline);

/* install prompt */
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  els.installBtn.hidden = false;
});
els.installBtn.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  els.installBtn.hidden = true;
});

/* boot */
if (!state.chats.length || !activeChat()) newChat();
els.systemPrompt.value = state.settings.system || DEFAULT_SYSTEM;
els.ttsToggle.checked = !!state.settings.tts;
els.wakeToggle.checked = !!state.settings.wake;
renderChatList();
renderMessages();
els.input.placeholder = isNarrow() ? 'Message JARVIS…' : 'Message JARVIS…  (Enter to send, Shift+Enter for newline)';
autosize();
updateOnline();
refreshHealth();
setInterval(refreshHealth, 30000);
if (state.settings.wake) startWakeListening();

/* share target / ?q= deep link */
const q = new URLSearchParams(location.search).get('q');
if (q) {
  history.replaceState({}, '', location.pathname);
  send(q);
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
