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

  // done labels
  const TOOL_DONE_LABELS = {
    otris_search: 'Dokumentation durchsucht',
    otris_read: 'Dokument gelesen',
    otris_list: 'Verzeichnis durchsucht',
    otris_overview: 'Übersicht geladen',
    otris_status: 'Status geprüft',
  };

  // svgs
  const SVG_SPINNER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>';
  const SVG_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
  const SVG_CHEVRON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
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

  // zufaellige texte
  var PLACEHOLDERS = [
    'Wo stehst du auf dem Schlauch?',
    'Was moechtest du wissen?',
    'Wie kann ich helfen?',
    'Stell mir eine Frage zur Doku...',
    'Was suchst du in der Dokumentation?',
    'Wobei brauchst du Hilfe?',
  ];

  var INIT_MESSAGES = [
    'Wir richten alles fuer dich ein...',
    'Einen kleinen Moment noch...',
    'Wird alles vorbereitet...',
    'Gleich kann es losgehen...',
  ];

  function randomFrom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  // zustand
  let ws = null;
  let isChat = false;
  let sessionReady = false;
  let currentAiMsg = null;
  let currentAiText = '';
  let isProcessing = false;

  // typewriter
  let textBuffer = '';
  let typewriterTimer = null;
  var CHARS_PER_TICK = 3;
  var TICK_MS = 12;

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
        appendError('Die Verbindung wurde unterbrochen. Lade die Seite einfach neu.');
      }
    };

    ws.onerror = function () {};
  }

  // events verarbeiten
  function handleEvent(msg) {
    switch (msg.type) {
      case 'session_init':
        sessionReady = false;
        if (sessionStatus) {
          sessionStatus.classList.remove('ready');
          sessionStatus.classList.add('loading');
          sessionStatus.querySelector('span').textContent = randomFrom(INIT_MESSAGES);
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
        landingInput.placeholder = randomFrom(PLACEHOLDERS);
        landingInput.focus();
        break;

      case 'chunk':
        if (!currentAiMsg) {
          currentAiMsg = appendAiMessage();
          currentAiText = '';
        }
        textBuffer += msg.content;
        startTypewriter();
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
        finishResponse();
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
        appendError(msg.message || 'Einen Moment noch — ich arbeite noch an deiner letzten Frage.');
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

    // sofort ai-message mit tool-block anzeigen
    currentAiMsg = appendAiMessage();
    currentAiText = '';
    getToolBlock(currentAiMsg);
    scrollToBottom();

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

  // typewriter — zeichen einzeln aus buffer in currentAiText schieben
  function startTypewriter() {
    if (typewriterTimer) return; // laeuft schon
    typewriterTimer = setInterval(typewriterTick, TICK_MS);
  }

  function typewriterTick() {
    if (textBuffer.length === 0) {
      clearInterval(typewriterTimer);
      typewriterTimer = null;
      return;
    }
    var chars = textBuffer.substring(0, CHARS_PER_TICK);
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

  // warten bis typewriter fertig, dann response abschliessen
  function finishResponse() {
    if (textBuffer.length > 0 || typewriterTimer) {
      setTimeout(finishResponse, 50);
      return;
    }
    if (currentAiMsg) {
      finalizeToolBlock(currentAiMsg);
      highlightCodeBlocks(currentAiMsg);
    }
    currentAiMsg = null;
    currentAiText = '';
    setInputEnabled(true);
  }

  // ai-inhalt rendern
  function renderAiContent() {
    if (!currentAiMsg) return;
    const contentEl = currentAiMsg.querySelector('.msg-content');
    if (contentEl) {
      contentEl.innerHTML = DOMPurify.sanitize(marked.parse(currentAiText));
    }
  }

  // tool-anzeige: kollabierter block mit spinner + aufklappbare details
  function getToolBlock(aiMsg) {
    var block = aiMsg.querySelector('.tool-block');
    if (block) return block;

    // neuen block erstellen
    block = document.createElement('div');
    block.className = 'tool-block';

    var header = document.createElement('div');
    header.className = 'tool-block-header';
    header.innerHTML = SVG_SPINNER + '<span class="tool-block-label">Doku wird durchsucht...</span><span class="tool-block-chevron">' + SVG_CHEVRON + '</span>';
    header.addEventListener('click', function () {
      block.classList.toggle('expanded');
    });

    var details = document.createElement('div');
    details.className = 'tool-block-details';

    block.appendChild(header);
    block.appendChild(details);

    var contentEl = aiMsg.querySelector('.msg-content');
    aiMsg.insertBefore(block, contentEl);
    return block;
  }

  function handleToolUse(msg) {
    if (!currentAiMsg) return;
    var block = getToolBlock(currentAiMsg);
    var details = block.querySelector('.tool-block-details');
    var label = TOOL_LABELS[msg.tool] || 'Verarbeite Anfrage';

    if (msg.status === 'running') {
      var item = document.createElement('div');
      item.className = 'tool-detail running';
      item.dataset.tool = msg.tool || 'default';
      item.innerHTML = SVG_SPINNER + '<span>' + label + '...</span>';
      details.appendChild(item);
    } else if (msg.status === 'done') {
      var items = details.querySelectorAll('.tool-detail.running[data-tool="' + (msg.tool || 'default') + '"]');
      var item = items[items.length - 1];
      if (item) {
        item.className = 'tool-detail done';
        var doneLabel = TOOL_DONE_LABELS[msg.tool] || 'Anfrage verarbeitet';
        item.innerHTML = SVG_CHECK + '<span>' + doneLabel + '</span>';
      }

      // counter aktualisieren
      var doneCount = details.querySelectorAll('.tool-detail.done').length;
      var headerLabel = block.querySelector('.tool-block-label');
      var hasRunning = details.querySelectorAll('.tool-detail.running').length > 0;
      if (hasRunning) {
        headerLabel.textContent = 'Doku wird durchsucht... (' + doneCount + ' abgeschlossen)';
      }
    }
  }

  // tool-block abschliessen (nach done)
  function finalizeToolBlock(aiMsg) {
    var block = aiMsg ? aiMsg.querySelector('.tool-block') : null;
    if (!block) return;
    block.classList.add('finished');
    var header = block.querySelector('.tool-block-header');
    var details = block.querySelector('.tool-block-details');
    var doneCount = details.querySelectorAll('.tool-detail.done').length;
    header.innerHTML = SVG_CHECK + '<span class="tool-block-label">' + doneCount + ' Quellen durchsucht</span><span class="tool-block-chevron">' + SVG_CHEVRON + '</span>';
    // re-attach click handler
    header.addEventListener('click', function () {
      block.classList.toggle('expanded');
    });
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
    flushTypewriter();
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
