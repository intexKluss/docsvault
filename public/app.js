// otris docs assistant - websocket client

(function () {
  'use strict';

  // tool name mapping
  const TOOL_LABELS = {
    otris_search: 'Durchsuche Dokumentation',
    otris_read: 'Lese Dokument',
    otris_list: 'Durchsuche Verzeichnis',
    otris_overview: 'Lade Übersicht',
    otris_status: 'Prüfe Status',
  };

  // svgs
  const SVG_SPINNER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>';
  const SVG_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
  const SVG_LIGHTNING = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>';
  const SVG_SEARCH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
  const SVG_SEND = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>';
  const SVG_STOP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>';

  // elemente
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

  // marked konfigurieren
  marked.setOptions({
    gfm: true,
    breaks: true,
  });

  // zustand
  let ws = null;
  let isChat = false;
  let sessionReady = false;
  let currentAiMsg = null;
  let currentAiText = '';
  let isProcessing = false;

  // websocket verbindung
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
        appendError('Verbindung verloren. Bitte Seite neu laden.');
      }
    };

    ws.onerror = function () {};
  }

  // events verarbeiten
  function handleEvent(msg) {
    switch (msg.type) {
      case 'session_init':
        // session wird gerade erstellt - status anzeigen
        sessionReady = false;
        if (sessionStatus) {
          sessionStatus.classList.remove('ready');
          sessionStatus.classList.add('loading');
        }
        break;

      case 'session_ready':
        // session ist bereit - input freigeben
        sessionReady = true;
        if (sessionStatus) {
          sessionStatus.classList.remove('loading');
          sessionStatus.classList.add('ready');
          sessionStatus.innerHTML = SVG_CHECK + '<span>Bereit</span>';
          // nach kurzer zeit ausblenden
          setTimeout(function () {
            sessionStatus.classList.add('hidden');
          }, 1500);
        }
        landingInput.disabled = false;
        landingInput.focus();
        break;

      case 'chunk':
        if (!currentAiMsg) {
          currentAiMsg = appendAiMessage();
          currentAiText = '';
        }
        currentAiText += msg.content;
        renderAiContent();
        scrollToBottom();
        break;

      case 'tool_use':
        if (!currentAiMsg) {
          currentAiMsg = appendAiMessage();
          currentAiText = '';
        }
        handleToolUse(msg);
        scrollToBottom();
        break;

      case 'done':
        if (currentAiMsg) {
          highlightCodeBlocks(currentAiMsg);
        }
        currentAiMsg = null;
        currentAiText = '';
        setInputEnabled(true);
        break;

      case 'report_saved':
        closeReportOverlay();
        appendSystemMessage('Bug-Report gespeichert. Danke!');
        break;

      case 'error':
        appendError(msg.message);
        setInputEnabled(true);
        break;

      case 'busy':
        appendError(msg.message || 'Bitte warte, bis die aktuelle Anfrage abgeschlossen ist.');
        setInputEnabled(true);
        break;
    }
  }

  // nachricht senden
  function sendMessage(text) {
    text = text.trim();
    if (!text || !ws || ws.readyState !== WebSocket.OPEN || !sessionReady) return;

    if (!isChat) {
      switchToChat();
    }

    appendUserMessage(text);

    const mode = getActiveSpeed().dataset.mode;
    ws.send(JSON.stringify({ type: 'message', content: text, mode: mode }));

    setInputEnabled(false);
    chatInput.value = '';
    autoResize(chatInput);
    chatInput.focus();
  }

  // zur chat-ansicht wechseln
  function switchToChat() {
    isChat = true;
    document.body.classList.remove('landing');
    document.body.classList.add('chat');
    // speed-modus übernehmen
    chatSpeed.dataset.mode = landingSpeed.dataset.mode;
    updateSpeedDisplay(chatSpeed);
  }

  // user-nachricht anzeigen
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

  // ai-nachricht erstellen
  function appendAiMessage() {
    const wrap = document.createElement('div');
    wrap.className = 'msg-wrap msg-ai';
    const content = document.createElement('div');
    content.className = 'msg-content';
    wrap.appendChild(content);
    messagesEl.appendChild(wrap);
    return wrap;
  }

  // ai-inhalt rendern
  function renderAiContent() {
    if (!currentAiMsg) return;
    const contentEl = currentAiMsg.querySelector('.msg-content');
    if (contentEl) {
      contentEl.innerHTML = DOMPurify.sanitize(marked.parse(currentAiText));
    }
  }

  // tool-anzeige
  function handleToolUse(msg) {
    if (!currentAiMsg) return;
    const label = TOOL_LABELS[msg.tool] || 'Verarbeite Anfrage';

    if (msg.status === 'running') {
      const indicator = document.createElement('div');
      indicator.className = 'tool-indicator running';
      indicator.dataset.tool = msg.tool || 'default';
      indicator.innerHTML = SVG_SPINNER + '<span>' + label + '...</span>';
      const contentEl = currentAiMsg.querySelector('.msg-content');
      currentAiMsg.insertBefore(indicator, contentEl);
    } else if (msg.status === 'done') {
      const indicators = currentAiMsg.querySelectorAll('.tool-indicator.running[data-tool="' + (msg.tool || 'default') + '"]');
      const indicator = indicators[indicators.length - 1];
      if (indicator) {
        indicator.className = 'tool-indicator done';
        const finalLabel = msg.tool === 'otris_search' ? 'Dokumentation durchsucht'
          : msg.tool === 'otris_read' ? 'Dokument gelesen'
          : msg.tool === 'otris_list' ? 'Verzeichnis durchsucht'
          : msg.tool === 'otris_overview' ? 'Übersicht geladen'
          : msg.tool === 'otris_status' ? 'Status geprüft'
          : 'Anfrage verarbeitet';
        indicator.innerHTML = SVG_CHECK + '<span>' + finalLabel + '</span>';
      }
    }
  }

  // fehler anzeigen
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

  // code-blöcke highlighten
  function highlightCodeBlocks(container) {
    if (!container || !window.hljs) return;
    container.querySelectorAll('pre code').forEach(function (block) {
      hljs.highlightElement(block);
    });
  }

  // auto-scroll
  function scrollToBottom() {
    requestAnimationFrame(function () {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    });
  }

  // input aktivieren/deaktivieren
  function setInputEnabled(enabled) {
    isProcessing = !enabled;
    chatInput.disabled = !enabled;
    updateChatSendButton();
  }

  // send-button zwischen senden/abbrechen umschalten
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

  // anfrage abbrechen
  function cancelRequest() {
    if (!isProcessing) return;
    if (currentAiMsg) {
      currentAiMsg.querySelectorAll('.tool-indicator.running').forEach(function (el) {
        el.className = 'tool-indicator done';
        el.innerHTML = SVG_CHECK + '<span>Abgebrochen</span>';
      });
      if (currentAiText) {
        highlightCodeBlocks(currentAiMsg);
      }
    }
    currentAiMsg = null;
    currentAiText = '';
    if (ws) {
      ws.onclose = null;
      ws.close();
    }
    setInputEnabled(true);
    // neu verbinden — neue session
    sessionReady = false;
    connect();
  }

  // aktiven speed-toggle ermitteln
  function getActiveSpeed() {
    return isChat ? chatSpeed : landingSpeed;
  }

  // speed-toggle umschalten
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

  // textarea auto-resize
  function autoResize(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
  }

  // send-button status
  function updateSendBtn(input, btn) {
    if (input === landingInput && !sessionReady) {
      btn.disabled = true;
      return;
    }
    btn.disabled = !input.value.trim();
  }

  // event listener

  // landing input
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

  // chat input
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

  // speed toggles
  landingSpeed.addEventListener('click', function () {
    toggleSpeed(this);
  });

  chatSpeed.addEventListener('click', function () {
    toggleSpeed(this);
  });

  // header buttons
  btnInstall.addEventListener('click', function () {
    window.open('/help/', '_blank');
  });

  btnNewChat.addEventListener('click', function () {
    location.reload();
  });

  // bug report
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
    var desc = reportText.value.trim();
    if (!desc || !ws || ws.readyState !== WebSocket.OPEN) return;

    // chat-verlauf als kontext sammeln
    var context = [];
    messagesEl.querySelectorAll('.msg-wrap').forEach(function (wrap) {
      var bubble = wrap.querySelector('.msg-bubble');
      var content = wrap.querySelector('.msg-content');
      if (bubble) {
        context.push({ role: 'user', text: bubble.textContent });
      } else if (content) {
        context.push({ role: 'assistant', text: content.textContent.substring(0, 500) });
      }
    });

    ws.send(JSON.stringify({
      type: 'report',
      description: desc,
      chatContext: context.slice(-10), // letzte 10 nachrichten
    }));

    reportSend.disabled = true;
  }

  // system-nachricht (nicht fehler, nicht ai)
  function appendSystemMessage(text) {
    var wrap = document.createElement('div');
    wrap.className = 'msg-wrap';
    var msg = document.createElement('div');
    msg.className = 'msg-system';
    msg.textContent = text;
    wrap.appendChild(msg);
    messagesEl.appendChild(wrap);
    scrollToBottom();
  }

  // verbindung starten
  connect();
})();
