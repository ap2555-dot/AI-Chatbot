(function () {
  'use strict';

  var MAX_CHARS = 2000;
  var MAX_HISTORY = 12;
  var REQUEST_TIMEOUT_MS = 30000;

  var $ = function (id) { return document.getElementById(id); };
  var messagesEl = $('messages');
  var emptyEl = $('empty');
  var formEl = $('composer');
  var inputEl = $('input');
  var sendEl = $('send');
  var countEl = $('count');
  var robotEl = $('robot');
  var statusEl = document.querySelector('.status');
  var statusText = $('status-text');
  var newChatEl = $('new-chat');
  var themeEl = $('theme-toggle');

  var history = []; // [{ role, content }]
  var busy = false;
  var controller = null;

  /* ---------- theme ---------- */
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    var next = theme === 'dark' ? 'light' : 'dark';
    themeEl.setAttribute('aria-label', 'Switch to ' + next + ' theme');
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#1b1d21' : '#f3f1ea');
  }
  applyTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark');
  themeEl.addEventListener('click', function () {
    var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try { localStorage.setItem('orbit-theme', next); } catch (e) { /* storage unavailable */ }
  });

  /* ---------- safe, minimal markdown ---------- */
  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function inline(text) {
    var out = escapeHtml(text);
    out = out.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>');
    return out;
  }

  function renderBlocks(text) {
    var lines = text.split('\n');
    var html = '';
    var para = [];
    var list = null; // { tag, items }

    function flushPara() {
      if (para.length) { html += '<p>' + para.map(inline).join('<br>') + '</p>'; para = []; }
    }
    function flushList() {
      if (list) {
        html += '<' + list.tag + '>' + list.items.map(function (i) { return '<li>' + inline(i) + '</li>'; }).join('') + '</' + list.tag + '>';
        list = null;
      }
    }

    lines.forEach(function (line) {
      var ul = line.match(/^\s*[-*•]\s+(.*)$/);
      var ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
      var h = line.match(/^#{1,6}\s+(.*)$/);
      if (ul || ol) {
        flushPara();
        var tag = ul ? 'ul' : 'ol';
        if (!list || list.tag !== tag) { flushList(); list = { tag: tag, items: [] }; }
        list.items.push((ul || ol)[1]);
      } else if (h) {
        flushPara(); flushList();
        html += '<h4>' + inline(h[1]) + '</h4>';
      } else if (!line.trim()) {
        flushPara(); flushList();
      } else {
        flushList();
        para.push(line);
      }
    });
    flushPara(); flushList();
    return html;
  }

  function renderMarkdown(text) {
    var parts = text.split(/```/);
    var html = '';
    parts.forEach(function (part, i) {
      if (i % 2 === 1) {
        var code = part.replace(/^[^\n]*\n/, function (first) { return /^\s*[\w+#.-]*\s*\n$/.test(first) ? '' : first; });
        html += '<pre><code>' + escapeHtml(code.replace(/\n$/, '')) + '</code></pre>';
      } else {
        html += renderBlocks(part);
      }
    });
    return html;
  }

  /* ---------- message rendering ---------- */
  function scrollToEnd() {
    var smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var last = messagesEl.lastElementChild;
    if (!last) return;
    if (getComputedStyle(messagesEl).overflowY === 'visible') {
      last.scrollIntoView({ block: 'end', behavior: smooth ? 'smooth' : 'auto' });
    } else {
      messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    }
  }

  function addMessage(role, text, opts) {
    opts = opts || {};
    var wrap = document.createElement('article');
    wrap.className = 'msg ' + (role === 'user' ? 'msg-user' : 'msg-bot') + (opts.error ? ' msg-error' : '');
    var who = document.createElement('span');
    who.className = 'who mono';
    who.textContent = role === 'user' ? 'YOU' : (opts.error ? 'ORBIT · ERROR' : 'ORBIT');
    var bubble = document.createElement('div');
    bubble.className = 'bubble';
    if (role === 'user') {
      var p = document.createElement('p');
      p.style.whiteSpace = 'pre-wrap';
      p.textContent = text;
      bubble.appendChild(p);
    } else if (opts.error) {
      var ep = document.createElement('p');
      ep.textContent = text;
      bubble.appendChild(ep);
    } else {
      bubble.innerHTML = renderMarkdown(text);
    }
    wrap.appendChild(who);
    wrap.appendChild(bubble);
    messagesEl.appendChild(wrap);
    scrollToEnd();
    return wrap;
  }

  function showTyping() {
    var wrap = document.createElement('article');
    wrap.className = 'msg msg-bot';
    wrap.id = 'typing';
    wrap.setAttribute('aria-label', 'Orbit is thinking');
    wrap.innerHTML = '<span class="who mono">ORBIT</span><div class="bubble typing" role="status"><span class="sr-only">Orbit is thinking…</span><i></i><i></i><i></i></div>';
    messagesEl.appendChild(wrap);
    scrollToEnd();
  }
  function hideTyping() {
    var t = $('typing');
    if (t) t.remove();
  }

  function clearError() {
    var e = messagesEl.querySelector('.msg-error');
    if (e) e.remove();
  }

  function setBusy(state) {
    busy = state;
    robotEl.classList.toggle('thinking', state);
    statusEl.classList.toggle('busy', state);
    statusText.textContent = state ? 'THINKING…' : 'ONLINE · READY';
    messagesEl.setAttribute('aria-busy', state ? 'true' : 'false');
    updateSend();
  }

  /* ---------- sending ---------- */
  function showError(message) {
    var node = addMessage('bot', message, { error: true });
    var retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'btn btn-ghost retry';
    retry.textContent = 'Try again';
    retry.addEventListener('click', function () {
      node.remove();
      request();
    });
    node.querySelector('.bubble').appendChild(retry);
    retry.focus({ preventScroll: true });
  }

  function request() {
    setBusy(true);
    showTyping();
    controller = new AbortController();
    var myController = controller;
    var timer = setTimeout(function () { myController.abort('timeout'); }, REQUEST_TIMEOUT_MS);

    fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: history.slice(-MAX_HISTORY) }),
      signal: myController.signal
    })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) { return { ok: res.ok, data: data }; });
      })
      .then(function (r) {
        if (myController !== controller) return; // chat was reset meanwhile
        hideTyping();
        if (r.ok && typeof r.data.reply === 'string') {
          history.push({ role: 'assistant', content: r.data.reply });
          addMessage('bot', r.data.reply);
          setBusy(false);
          if (matchMedia('(pointer: fine)').matches) inputEl.focus({ preventScroll: true });
        } else {
          setBusy(false);
          showError(r.data.error || 'Something went wrong. Please try again.');
        }
      })
      .catch(function (err) {
        if (myController !== controller) return;
        hideTyping();
        setBusy(false);
        var timedOut = err && (err.name === 'AbortError' || err === 'timeout');
        showError(timedOut ? 'That took too long. Please try again.' : 'Could not reach Orbit. Check your connection and try again.');
      })
      .then(function () { clearTimeout(timer); });
  }

  function send(text) {
    text = text.trim();
    if (!text || busy) return;
    if (text.length > MAX_CHARS) return;
    clearError();
    if (emptyEl && emptyEl.parentNode) emptyEl.remove();
    history.push({ role: 'user', content: text });
    addMessage('user', text);
    inputEl.value = '';
    autosize();
    updateSend();
    request();
  }

  /* ---------- composer ---------- */
  function autosize() {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight + 2, 160) + 'px';
    countEl.textContent = inputEl.value.length + '/' + MAX_CHARS;
    countEl.classList.toggle('warn', inputEl.value.length > MAX_CHARS * 0.9);
  }
  function updateSend() {
    sendEl.disabled = busy || !inputEl.value.trim();
  }

  inputEl.addEventListener('input', function () { autosize(); updateSend(); });
  inputEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send(inputEl.value);
    }
  });
  formEl.addEventListener('submit', function (e) {
    e.preventDefault();
    send(inputEl.value);
  });

  $('chips').addEventListener('click', function (e) {
    var chip = e.target.closest('.chip');
    if (chip) send(chip.getAttribute('data-prompt'));
  });

  /* ---------- new chat ---------- */
  newChatEl.addEventListener('click', function () {
    if (controller) { controller.abort(); controller = null; }
    history = [];
    hideTyping();
    messagesEl.innerHTML = '';
    messagesEl.appendChild(emptyEl);
    setBusy(false);
    inputEl.value = '';
    autosize();
    updateSend();
    inputEl.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  });

  autosize();
  updateSend();
})();
