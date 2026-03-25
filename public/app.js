(function () {
  'use strict';

  const TOOL_LABELS = {
    otris_search: 'Durchsuche Dokumentation',
    otris_read: 'Lese Dokument',
    otris_list: 'Durchsuche Verzeichnis',
    otris_overview: 'Lade Übersicht',
    otris_status: 'Prüfe Status',
  };

  const TOOL_DONE_LABELS = {
    otris_search: 'Dokumentation durchsucht',
    otris_read: 'Dokument gelesen',
    otris_list: 'Verzeichnis durchsucht',
    otris_overview: 'Übersicht geladen',
    otris_status: 'Status geprüft',
  };

  const SVG_SPINNER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>';
  const SVG_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
  const SVG_CHEVRON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
  const SVG_LIGHTNING = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>';
  const SVG_SEARCH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
  const SVG_SEND = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>';
  const SVG_STOP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>';

  const landingEl = document.getElementById('landing');
  const chatEl = document.getElementById('chat');
  const messagesEl = document.getElementById('messages');
  const landingInput = document.getElementById('landing-input');
  const chatInput = document.getElementById('chat-input');
  const landingSend = document.getElementById('landing-send');
  const chatSend = document.getElementById('chat-send');
  const landingSpeed = document.getElementById('landing-speed');
  const chatSpeed = document.getElementById('chat-speed');
  const btnInstall = document.getElementById('btn-install');
  const btnNewChat = document.getElementById('btn-new-chat');
  const btnReport = document.getElementById('btn-report');
  const reportOverlay = document.getElementById('report-overlay');
  const reportText = document.getElementById('report-text');
  const reportSend = document.getElementById('report-send');
  const reportCancel = document.getElementById('report-cancel');
  const sessionStatus = document.getElementById('session-status');
  const btnTheme = document.getElementById('btn-theme');
  const hljsTheme = document.getElementById('hljs-theme');

  marked.setOptions({ gfm: true, breaks: true });

  const PLACEHOLDERS = [
    'Wo stehst du auf dem Schlauch?',
    'Was moechtest du wissen?',
    'Wie kann ich helfen?',
    'Stell mir eine Frage zur Doku...',
    'Was suchst du in der Dokumentation?',
    'Wobei brauchst du Hilfe?',
  ];

  const INIT_MESSAGES = [
    'Wir richten alles fuer dich ein...',
    'Einen kleinen Moment noch...',
    'Wird alles vorbereitet...',
    'Gleich kann es losgehen...',
  ];

  function randomFrom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  let ws = null;
  let isChat = false;
  let sessionReady = false;
  let currentAiMsg = null;
  let currentAiText = '';
  let isProcessing = false;
  let cancelled = false;
  let messageId = 0;

  let textBuffer = '';
  let typewriterTimer = null;
  const CHARS_PER_TICK = 3;
  const TICK_MS = 12;

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = proto + '//' + location.host;

    ws = new WebSocket(url);

    ws.onmessage = function (e) {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      handleEvent(msg);
    };

    ws.onclose = function () {
      if (isChat) {
        appendError('Die Verbindung wurde unterbrochen. Lade die Seite einfach neu.');
      }
    };

    ws.onerror = function () {
      console.warn('[ws] connection error');
    };
  }

  function handleEvent(msg) {
    if (!msg || typeof msg.type !== 'string') return;
    if (cancelled) return;

    switch (msg.type) {
      case 'session_init':
        sessionReady = false;
        if (sessionStatus) {
          sessionStatus.classList.remove('hidden');
          sessionStatus.classList.remove('ready');
          sessionStatus.classList.add('loading');
          sessionStatus.querySelector('span').textContent = randomFrom(INIT_MESSAGES);
        }
        break;

      case 'session_ready':
        sessionReady = true;
        cancelled = false;
        if (isChat) setInputEnabled(true);
        if (sessionStatus) {
          sessionStatus.classList.remove('loading');
          sessionStatus.classList.add('ready');
          sessionStatus.innerHTML = SVG_CHECK + '<span>Bereit</span>';
          setTimeout(function () {
            sessionStatus.classList.add('hidden');
          }, 1500);
        }
        landingInput.disabled = false;
        landingInput.placeholder = randomFrom(PLACEHOLDERS);
        landingInput.focus();
        break;

      case 'chunk':
        if (typeof msg.content !== 'string') break;
        if (!currentAiMsg) {
          currentAiMsg = appendAiMessage();
          currentAiText = '';
        }
        textBuffer += msg.content;
        startTypewriter();
        break;

      case 'tool_use':
        if (!msg.tool || !msg.status) break;
        if (!currentAiMsg) {
          currentAiMsg = appendAiMessage();
          currentAiText = '';
        }
        handleToolUse(msg);
        scrollToBottom();
        break;

      case 'done':
        finishResponse(messageId);
        break;

      case 'report_saved':
        closeReportOverlay();
        appendSystemMessage('Bug-Report gespeichert. Danke!');
        break;

      case 'error':
        flushTypewriter();
        appendError(typeof msg.message === 'string' ? msg.message : 'Unbekannter Fehler');
        currentAiMsg = null;
        currentAiText = '';
        textBuffer = '';
        setInputEnabled(true);
        break;

    }
  }

  function sendMessage(text) {
    text = text.trim();
    if (!text || !ws || ws.readyState !== WebSocket.OPEN || !sessionReady) return;

    if (!isChat) {
      switchToChat();
    }

    appendUserMessage(text);

    const mode = getActiveSpeed().dataset.mode;
    ws.send(JSON.stringify({ type: 'message', content: text, mode: mode }));

    messageId++;
    currentAiMsg = null;
    currentAiText = '';
    userScrolledUp = false;
    scrollToBottom();

    setInputEnabled(false);
    chatInput.value = '';
    autoResize(chatInput);
  }

  function switchToChat() {
    isChat = true;
    document.body.classList.remove('landing');
    document.body.classList.add('chat');
    chatSpeed.dataset.mode = landingSpeed.dataset.mode;
    updateSpeedDisplay(chatSpeed);
  }

  function appendUserMessage(text) {
    const wrap = document.createElement('div');
    wrap.className = 'msg-wrap msg-user';
    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    bubble.textContent = text;
    wrap.appendChild(bubble);
    messagesEl.appendChild(wrap);
    scrollToBottom();
  }

  function appendAiMessage() {
    const wrap = document.createElement('div');
    wrap.className = 'msg-wrap msg-ai';
    const content = document.createElement('div');
    content.className = 'msg-content';
    wrap.appendChild(content);
    messagesEl.appendChild(wrap);
    return wrap;
  }

  function startTypewriter() {
    if (typewriterTimer) return;
    typewriterTimer = setInterval(typewriterTick, TICK_MS);
  }

  function typewriterTick() {
    if (textBuffer.length === 0) {
      clearInterval(typewriterTimer);
      typewriterTimer = null;
      return;
    }
    const chars = textBuffer.substring(0, CHARS_PER_TICK);
    textBuffer = textBuffer.substring(CHARS_PER_TICK);
    currentAiText += chars;
    renderAiContent();
    scrollToBottom();
  }

  function flushTypewriter() {
    if (typewriterTimer) {
      clearInterval(typewriterTimer);
      typewriterTimer = null;
    }
    if (textBuffer.length > 0) {
      currentAiText += textBuffer;
      textBuffer = '';
      renderAiContent();
      scrollToBottom();
    }
  }

  function finishResponse(msgId) {
    var attempts = 0;
    function tryFinish() {
      if (msgId !== messageId) return;
      if ((textBuffer.length > 0 || typewriterTimer) && attempts++ < 200) {
        setTimeout(tryFinish, 50);
        return;
      }
      if (textBuffer.length > 0) flushTypewriter();

      if (currentAiMsg) {
        if (!currentAiText && !currentAiMsg.querySelector('.tool-block')) {
          currentAiMsg.remove();
        } else {
          finalizeToolBlock(currentAiMsg);
          highlightCodeBlocks(currentAiMsg);
        }
      }
      currentAiMsg = null;
      currentAiText = '';
      setInputEnabled(true);
    }
    tryFinish();
  }

  function renderAiContent() {
    if (!currentAiMsg) return;
    const contentEl = currentAiMsg.querySelector('.msg-content');
    if (contentEl) {
      contentEl.innerHTML = DOMPurify.sanitize(marked.parse(currentAiText));
    }
  }

  function getToolBlock(aiMsg) {
    let block = aiMsg.querySelector('.tool-block');
    if (block) return block;

    block = document.createElement('div');
    block.className = 'tool-block';

    const header = document.createElement('div');
    header.className = 'tool-block-header';
    header.innerHTML = SVG_SPINNER + '<span class="tool-block-label">Doku wird durchsucht...</span><span class="tool-block-chevron">' + SVG_CHEVRON + '</span>';

    function toggleExpand() {
      block.classList.toggle('expanded');
    }
    header.addEventListener('click', toggleExpand);
    header._toggleExpand = toggleExpand;

    const details = document.createElement('div');
    details.className = 'tool-block-details';

    block.appendChild(header);
    block.appendChild(details);

    const contentEl = aiMsg.querySelector('.msg-content');
    aiMsg.insertBefore(block, contentEl);
    return block;
  }

  function handleToolUse(msg) {
    if (!currentAiMsg) return;
    const block = getToolBlock(currentAiMsg);
    const details = block.querySelector('.tool-block-details');
    const label = TOOL_LABELS[msg.tool] || 'Verarbeite Anfrage';

    if (msg.status === 'running') {
      const item = document.createElement('div');
      item.className = 'tool-detail running';
      item.dataset.tool = msg.tool || 'default';
      item.innerHTML = SVG_SPINNER + '<span>' + label + '...</span>';
      details.appendChild(item);
    } else if (msg.status === 'done') {
      // CSS.escape gegen selector injection
      const safeTool = CSS.escape(msg.tool || 'default');
      const items = details.querySelectorAll('.tool-detail.running[data-tool="' + safeTool + '"]');
      const item = items[items.length - 1];
      if (item) {
        item.className = 'tool-detail done';
        const doneLabel = TOOL_DONE_LABELS[msg.tool] || 'Anfrage verarbeitet';
        item.innerHTML = SVG_CHECK + '<span>' + doneLabel + '</span>';
      }

      const doneCount = details.querySelectorAll('.tool-detail.done').length;
      const headerLabel = block.querySelector('.tool-block-label');
      const hasRunning = details.querySelectorAll('.tool-detail.running').length > 0;
      if (hasRunning) {
        headerLabel.textContent = 'Doku wird durchsucht... (' + doneCount + ' abgeschlossen)';
      }
    }
  }

  function finalizeToolBlock(aiMsg) {
    const block = aiMsg ? aiMsg.querySelector('.tool-block') : null;
    if (!block) return;
    block.classList.add('finished');

    const header = block.querySelector('.tool-block-header');
    const details = block.querySelector('.tool-block-details');
    const doneCount = details.querySelectorAll('.tool-detail.done').length;

    if (header._toggleExpand) {
      header.removeEventListener('click', header._toggleExpand);
    }

    const label = header.querySelector('.tool-block-label');
    const icon = header.querySelector('svg');
    if (label) label.textContent = doneCount + ' Quellen durchsucht';
    if (icon) icon.outerHTML = SVG_CHECK;

    function toggleExpand() {
      block.classList.toggle('expanded');
    }
    header.addEventListener('click', toggleExpand);
    header._toggleExpand = toggleExpand;
  }

  function appendError(text) {
    const wrap = document.createElement('div');
    wrap.className = 'msg-wrap';
    const err = document.createElement('div');
    err.className = 'msg-error';
    err.textContent = text;
    wrap.appendChild(err);
    messagesEl.appendChild(wrap);
    scrollToBottom();
  }

  function highlightCodeBlocks(container) {
    if (!container || !window.hljs) return;
    container.querySelectorAll('pre code').forEach(function (block) {
      hljs.highlightElement(block);
    });
  }

  let userScrolledUp = false;

  messagesEl.addEventListener('wheel', function (e) {
    if (e.deltaY < 0) {
      userScrolledUp = true;
      updateScrollButton();
    }
  }, { passive: true });

  messagesEl.addEventListener('touchmove', function () {
    const distanceFromBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
    if (distanceFromBottom > 40) {
      userScrolledUp = true;
      updateScrollButton();
    }
  }, { passive: true });

  messagesEl.addEventListener('scroll', function () {
    const distanceFromBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
    if (distanceFromBottom < 20 && userScrolledUp) {
      userScrolledUp = false;
      updateScrollButton();
    }
  });

  function scrollToBottom(force) {
    if (!force && userScrolledUp) return;
    requestAnimationFrame(function () {
      messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: force ? 'smooth' : 'auto' });
      userScrolledUp = false;
      updateScrollButton();
    });
  }

  const scrollBtn = document.createElement('button');
  scrollBtn.className = 'scroll-to-bottom hidden';
  scrollBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
  scrollBtn.addEventListener('click', function () {
    scrollToBottom(true);
  });
  document.getElementById('chat').appendChild(scrollBtn);

  function updateScrollButton() {
    if (userScrolledUp && isChat) {
      scrollBtn.classList.remove('hidden');
    } else {
      scrollBtn.classList.add('hidden');
    }
  }

  function setInputEnabled(enabled) {
    isProcessing = !enabled;
    chatInput.disabled = !enabled;
    updateChatSendButton();
    if (enabled && isChat) {
      chatInput.focus();
    }
  }

  function updateChatSendButton() {
    if (isProcessing) {
      chatSend.innerHTML = SVG_STOP;
      chatSend.classList.add('stop-btn');
      chatSend.disabled = false;
    } else {
      chatSend.innerHTML = SVG_SEND;
      chatSend.classList.remove('stop-btn');
      chatSend.disabled = !chatInput.value.trim();
    }
  }

  function cancelRequest() {
    if (!isProcessing) return;
    cancelled = true;
    messageId++;
    flushTypewriter();
    if (currentAiMsg) {
      currentAiMsg.querySelectorAll('.tool-detail.running').forEach(function (el) {
        el.className = 'tool-detail done';
        el.innerHTML = SVG_CHECK + '<span>Abgebrochen</span>';
      });
      if (currentAiText) {
        highlightCodeBlocks(currentAiMsg);
      }
    }
    currentAiMsg = null;
    currentAiText = '';
    textBuffer = '';
    if (ws) {
      ws.onclose = null;
      ws.close();
    }
    sessionReady = false;
    connect();
  }

  function getActiveSpeed() {
    return isChat ? chatSpeed : landingSpeed;
  }

  function toggleSpeed(btn) {
    if (btn.dataset.mode === 'fast') {
      btn.dataset.mode = 'thorough';
    } else {
      btn.dataset.mode = 'fast';
    }
    updateSpeedDisplay(btn);
  }

  function updateSpeedDisplay(btn) {
    if (btn.dataset.mode === 'fast') {
      btn.innerHTML = SVG_LIGHTNING + '<span>Schnell</span>';
      btn.title = 'Schnell';
    } else {
      btn.innerHTML = SVG_SEARCH + '<span>Gründlich</span>';
      btn.title = 'Gründlich';
    }
  }

  function autoResize(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
  }

  function updateSendBtn(input, btn) {
    if (input === landingInput && !sessionReady) {
      btn.disabled = true;
      return;
    }
    btn.disabled = !input.value.trim();
  }

  landingInput.addEventListener('input', function () {
    autoResize(this);
    updateSendBtn(this, landingSend);
  });

  landingInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(this.value);
    }
  });

  landingSend.addEventListener('click', function () {
    sendMessage(landingInput.value);
  });

  chatInput.addEventListener('input', function () {
    autoResize(this);
    updateSendBtn(this, chatSend);
  });

  chatInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(this.value);
    }
  });

  chatSend.addEventListener('click', function () {
    if (isProcessing) {
      cancelRequest();
    } else {
      sendMessage(chatInput.value);
    }
  });

  landingSpeed.addEventListener('click', function () {
    toggleSpeed(this);
  });

  chatSpeed.addEventListener('click', function () {
    toggleSpeed(this);
  });

  btnInstall.addEventListener('click', function () {
    window.open('/help/', '_blank');
  });

  btnNewChat.addEventListener('click', function () {
    location.reload();
  });

  const SVG_SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';
  const SVG_MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';

  function updateThemeButton() {
    var isLight = document.documentElement.getAttribute('data-theme') === 'light';
    btnTheme.innerHTML = isLight ? SVG_MOON : SVG_SUN;
    btnTheme.title = isLight ? 'Dark Mode' : 'Light Mode';
  }

  btnTheme.addEventListener('click', function () {
    var isLight = document.documentElement.getAttribute('data-theme') === 'light';
    var newTheme = isLight ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    hljsTheme.href = newTheme === 'light'
      ? 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css'
      : 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css';
    updateThemeButton();
  });

  updateThemeButton();

  btnReport.addEventListener('click', function () {
    openReportOverlay();
  });

  reportCancel.addEventListener('click', function () {
    closeReportOverlay();
  });

  reportSend.addEventListener('click', function () {
    submitReport();
  });

  reportText.addEventListener('input', function () {
    reportSend.disabled = !this.value.trim();
  });

  reportOverlay.addEventListener('click', function (e) {
    if (e.target === reportOverlay) closeReportOverlay();
  });

  function openReportOverlay() {
    reportText.value = '';
    reportSend.disabled = true;
    reportOverlay.classList.remove('hidden');
    reportText.focus();
  }

  function closeReportOverlay() {
    reportOverlay.classList.add('hidden');
  }

  function submitReport() {
    const desc = reportText.value.trim();
    if (!desc || !ws || ws.readyState !== WebSocket.OPEN) return;

    const context = [];
    messagesEl.querySelectorAll('.msg-wrap').forEach(function (wrap) {
      const bubble = wrap.querySelector('.msg-bubble');
      const content = wrap.querySelector('.msg-content');
      if (bubble) {
        context.push({ role: 'user', text: bubble.textContent });
      } else if (content) {
        context.push({ role: 'assistant', text: content.textContent.substring(0, 500) });
      }
    });

    ws.send(JSON.stringify({
      type: 'report',
      description: desc,
      chatContext: context.slice(-10),
    }));

    reportSend.disabled = true;
  }

  function appendSystemMessage(text) {
    const wrap = document.createElement('div');
    wrap.className = 'msg-wrap';
    const msg = document.createElement('div');
    msg.className = 'msg-system';
    msg.textContent = text;
    wrap.appendChild(msg);
    messagesEl.appendChild(wrap);
    scrollToBottom();
  }

  connect();
})();
