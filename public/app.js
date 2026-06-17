(function () {
  'use strict';

  // labels werden pro tool-suffix (search/read/list/overview/status) gemapped,
  // damit auch vaults mit anderem prefix als otris (z.b. intex_regeln_search) funktionieren
  const TOOL_LABELS = {
    search: 'Durchsuche Dokumentation',
    read: 'Lese Dokument',
    list: 'Durchsuche Verzeichnis',
    overview: 'Lade Übersicht',
    status: 'Prüfe Status',
  };

  const TOOL_DONE_LABELS = {
    search: 'Dokumentation durchsucht',
    read: 'Dokument gelesen',
    list: 'Verzeichnis durchsucht',
    overview: 'Übersicht geladen',
    status: 'Status geprüft',
  };

  function toolLabel(name, map) {
    const m = name && name.match(/_(search|read|list|overview|status)$/);
    return m ? map[m[1]] : null;
  }

  const SVG_SPINNER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>';
  const SVG_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
  const SVG_CHEVRON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
  const SVG_LIGHTNING = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>';
  const SVG_SEARCH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
  const SVG_SEND = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>';
  const SVG_STOP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>';
  const SVG_COPY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';

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
  const landingTheme = document.getElementById('landing-theme');
  const hljsTheme = document.getElementById('hljs-theme');
  const vaultSelectorEl = document.getElementById('vault-selector');
  const vaultBadgeEl = document.getElementById('vault-badge');
  const vaultBadgeName = vaultBadgeEl ? vaultBadgeEl.querySelector('.vault-badge-name') : null;

  marked.setOptions({ gfm: true, breaks: true });

  const PLACEHOLDERS = [
    'Wo stehst du auf dem Schlauch?',
    'Was möchtest du wissen?',
    'Wie kann ich helfen?',
    'Stell mir eine Frage zur Doku...',
    'Was suchst du in der Dokumentation?',
    'Wobei brauchst du Hilfe?',
    'Welches Dokument versteckt sich vor dir?',
    'Bevor du den Aktenkeller durchwühlst: frag mich',
    'Welche Akte raubt dir gerade den Schlaf?',
    'Papierstau im Kopf? Einfach fragen.',
    'Suchst du die Nadel im Akten-Heuhaufen?',
    'Welches PDF macht dir gerade Ärger?',
  ];

  const INIT_MESSAGES = [
    'Wir richten alles für dich ein...',
    'Einen kleinen Moment noch...',
    'Wird alles vorbereitet...',
    'Gleich kann es losgehen...',
    'Wir sortieren noch schnell die Akten...',
    'Der Aktenschrank wird aufgeschlossen...',
    'Wir heften alles sauber ab...',
    'Noch schnell den Locher nachladen...',
    'Wir wischen den Staub vom Archiv...',
  ];

  function randomFrom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function activeVault() {
    return vaults.find(function (v) { return v.toolPrefix === activeVaultPrefix; }) || null;
  }

  function buildInputPlaceholder() {
    const v = activeVault();
    if (v && vaults.length >= 2) {
      return 'Was willst du zu ' + v.name + ' wissen?';
    }
    return randomFrom(PLACEHOLDERS);
  }

  function handleVaultsList(list) {
    vaults = list.filter(function (v) {
      return v && typeof v.toolPrefix === 'string' && typeof v.name === 'string';
    });
    if (vaults.length === 0) {
      vaultSelectorEl.classList.add('hidden');
      // kein vault = nichts wird je bereit. statt ewig "wird vorbereitet" klar sagen.
      sessionReady = false;
      landingInput.disabled = true;
      landingSend.disabled = true;
      landingInput.placeholder = 'Keine Dokumentation verfügbar';
      if (sessionStatus) {
        cancelSessionStatusHide();
        sessionStatus.classList.remove('loading', 'hidden', 'ready');
        setSessionStatus('', 'Keine Dokumentation verfügbar. Bitte den Administrator kontaktieren.');
      }
      return;
    }

    // Default = erster Vault in der vom Server gelieferten Reihenfolge
    if (!activeVaultPrefix || !vaults.some(function (v) { return v.toolPrefix === activeVaultPrefix; })) {
      activeVaultPrefix = vaults[0].toolPrefix;
    }

    if (vaults.length >= 2) {
      renderVaultSelector();
      vaultSelectorEl.classList.remove('hidden');
      updateVaultBadge();
      // Server warmt bei >=2 Vaults erst nach select_vault
      sendSelectVault(activeVaultPrefix);
    } else {
      vaultSelectorEl.classList.add('hidden');
      updateVaultBadge();
      // Single-vault-case: Server wärmt selbst, kein select_vault nötig
    }

    landingInput.placeholder = sessionReady ? buildInputPlaceholder() : randomFrom(INIT_MESSAGES);
  }

  function renderVaultSelector() {
    vaultSelectorEl.innerHTML = '';
    vaults.forEach(function (v) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'vault-segment' + (v.toolPrefix === activeVaultPrefix ? ' active' : '');
      btn.textContent = v.name;
      btn.title = v.description || v.name;
      btn.dataset.toolPrefix = v.toolPrefix;
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', v.toolPrefix === activeVaultPrefix ? 'true' : 'false');
      if (vaultLocked) btn.disabled = true;
      btn.addEventListener('click', function () {
        selectVault(v.toolPrefix);
      });
      vaultSelectorEl.appendChild(btn);
    });
  }

  function selectVault(prefix) {
    if (vaultLocked) return;
    if (prefix === activeVaultPrefix && sessionReady) return;
    activeVaultPrefix = prefix;
    vaults.forEach(function (v) {
      const btn = vaultSelectorEl.querySelector('[data-tool-prefix="' + CSS.escape(v.toolPrefix) + '"]');
      if (!btn) return;
      const isActive = v.toolPrefix === prefix;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    updateVaultBadge();
    // Umschalten heißt: Server baut Session neu auf -> ab jetzt wieder warten
    sessionReady = false;
    landingInput.disabled = true;
    landingSend.disabled = true;
    if (sessionStatus) {
      // alten hide-timer abbrechen, sonst macht er uns die fresh-loading-anzeige hidden
      cancelSessionStatusHide();
      sessionStatus.classList.remove('hidden', 'ready');
      sessionStatus.classList.add('loading');
      setSessionStatus(SVG_SPINNER, 'Wird auf ' + activeVault().name + ' umgestellt...');
    }
    sendSelectVault(prefix);
  }

  function sendSelectVault(prefix) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'select_vault', toolPrefix: prefix }));
  }

  function updateVaultBadge() {
    if (!vaultBadgeEl || !vaultBadgeName) return;
    const v = activeVault();
    if (v && vaults.length >= 2) {
      vaultBadgeName.textContent = v.name;
      vaultBadgeEl.classList.remove('hidden');
    } else {
      vaultBadgeEl.classList.add('hidden');
    }
  }

  function lockVaultSelector() {
    if (vaultLocked) return;
    vaultLocked = true;
    const segments = vaultSelectorEl.querySelectorAll('.vault-segment');
    segments.forEach(function (btn) {
      btn.disabled = true;
    });
  }

  let ws = null;
  let isChat = false;
  let sessionReady = false;
  let currentAiMsg = null;
  let currentAiText = '';
  let isProcessing = false;
  let cancelled = false;
  let messageId = 0;
  let vaults = [];
  let activeVaultPrefix = null;
  let vaultLocked = false;
  let sessionStatusHideTimer = null;

  function cancelSessionStatusHide() {
    if (sessionStatusHideTimer) {
      clearTimeout(sessionStatusHideTimer);
      sessionStatusHideTimer = null;
    }
  }

  // status setzen: icon ist trusted svg-konstante, text via textContent (kein innerHTML
  // für dynamische werte wie vault-namen)
  function setSessionStatus(iconSvg, text) {
    if (!sessionStatus) return;
    sessionStatus.innerHTML = iconSvg || '';
    const span = document.createElement('span');
    span.textContent = text;
    sessionStatus.appendChild(span);
  }

  function scheduleSessionStatusHide() {
    cancelSessionStatusHide();
    sessionStatusHideTimer = setTimeout(function () {
      sessionStatus.classList.add('hidden');
      sessionStatusHideTimer = null;
    }, 1500);
  }

  let textBuffer = '';
  let typewriterTimer = null;
  const CHARS_PER_TICK = 3;
  const TICK_MS = 12;
  // render throttle: text-buffer wächst jeden tick, aber das teure marked.parse +
  // sanitize läuft nur ~alle 60ms statt jede 12ms (sonst O(n^2) auf wachsendem doku)
  const RENDER_MS = 60;
  let lastRenderTs = 0;

  // markdown/llm-output: code, tabellen, links erlaubt; svg/style raus (siehe public/help)
  const SANITIZE_MD = {
    ALLOWED_URI_REGEXP: /^(?:https?|mailto|tel|#|\/|\.\/|\.\.\/)/i,
    FORBID_TAGS: ['svg', 'math', 'form', 'iframe', 'object', 'embed'],
    FORBID_ATTR: ['style'],
    ADD_ATTR: ['target', 'rel'],
  };

  function sanitizeMarkdown(md) {
    return DOMPurify.sanitize(marked.parse(md), SANITIZE_MD);
  }

  // reconnect/lifecycle-state
  let intentionalClose = false;
  let reconnectAttempts = 0;
  let reconnectTimer = null;
  const MAX_RECONNECT_ATTEMPTS = 5;
  // global watchdog: wenn eine antwort nie fertig wird, ui wieder freigeben
  let responseTimeoutTimer = null;
  const RESPONSE_TIMEOUT_MS = 120000;
  // report-overlay state, damit fehler im overlay statt im chat landen
  let reportPending = false;
  // muss zum server-default passen (MAX_MESSAGE_LENGTH, src/session-manager.js)
  const MAX_MESSAGE_LENGTH = 2000;

  // gemeinsame aufräumlogik: typewriter leeren, laufenden tool-block abschließen,
  // leere ai-bubble entfernen. die input-freigabe machen die aufrufer selbst, weil
  // cancel/onclose/error/timeout sie unterschiedlich behandeln.
  function finalizeActiveResponse() {
    clearResponseTimeout();
    flushTypewriter();
    if (currentAiMsg) {
      currentAiMsg.querySelectorAll('.tool-detail.running').forEach(function (el) {
        el.className = 'tool-detail done';
        el.innerHTML = SVG_CHECK + '<span>Abgebrochen</span>';
      });
      finalizeToolBlock(currentAiMsg);
      if (currentAiText) {
        highlightCodeBlocks(currentAiMsg);
      } else if (!currentAiMsg.querySelector('.tool-block')) {
        currentAiMsg.remove();
      }
    }
    currentAiMsg = null;
    currentAiText = '';
    textBuffer = '';
  }

  function clearResponseTimeout() {
    if (responseTimeoutTimer) {
      clearTimeout(responseTimeoutTimer);
      responseTimeoutTimer = null;
    }
  }

  function startResponseTimeout() {
    clearResponseTimeout();
    responseTimeoutTimer = setTimeout(function () {
      responseTimeoutTimer = null;
      if (!isProcessing) return;
      finalizeActiveResponse();
      appendError('Die Antwort hat zu lange gedauert. Bitte versuche es erneut.');
      setInputEnabled(true);
    }, RESPONSE_TIMEOUT_MS);
  }

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

    ws.onopen = function () {
      reconnectAttempts = 0;
    };

    ws.onclose = function () {
      // bewusster close (cancel/new-chat): nichts tun, der jeweilige pfad regelt das
      if (intentionalClose) {
        intentionalClose = false;
        return;
      }
      // unerwarteter abbruch: laufende antwort sauber beenden und reconnect versuchen
      finalizeActiveResponse();
      setInputEnabled(false);
      attemptReconnect();
    };

    ws.onerror = function () {
      console.warn('[ws] connection error');
    };
  }

  function attemptReconnect() {
    if (reconnectTimer) return;
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      if (isChat) {
        appendError('Die Verbindung wurde unterbrochen. Lade die Seite einfach neu.');
      }
      return;
    }
    reconnectAttempts++;
    showReconnectingStatus();
    // einfacher backoff: 1s, 2s, 3s ...
    const delay = reconnectAttempts * 1000;
    reconnectTimer = setTimeout(function () {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  // im chat gibt es keine sichtbare status-leiste (die session-status liegt im
  // landing-screen, der dann display:none ist), drum hier eine eigene info-zeile
  let reconnectNoticeEl = null;

  function showReconnectingStatus() {
    if (isChat) {
      if (!reconnectNoticeEl) {
        reconnectNoticeEl = document.createElement('div');
        reconnectNoticeEl.className = 'msg-wrap';
        const inner = document.createElement('div');
        inner.className = 'msg-system reconnecting';
        inner.textContent = 'Verbindung wird wiederhergestellt...';
        reconnectNoticeEl.appendChild(inner);
        messagesEl.appendChild(reconnectNoticeEl);
        scrollToBottom();
      }
      return;
    }
    if (!sessionStatus) return;
    cancelSessionStatusHide();
    sessionStatus.classList.remove('hidden', 'ready');
    sessionStatus.classList.add('loading');
    setSessionStatus(SVG_SPINNER, 'Verbindung wird wiederhergestellt...');
  }

  function clearReconnectNotice() {
    if (reconnectNoticeEl) {
      reconnectNoticeEl.remove();
      reconnectNoticeEl = null;
    }
  }

  // streaming-events werden nach einem cancel verworfen, lifecycle-events nicht
  // (sonst geht das frische session_ready nach reconnect verloren -> chat bricht)
  const STREAMING_EVENTS = { chunk: true, tool_use: true, done: true };

  function handleEvent(msg) {
    if (!msg || typeof msg.type !== 'string') return;
    if (cancelled && STREAMING_EVENTS[msg.type]) return;

    switch (msg.type) {
      case 'vaults':
        handleVaultsList(Array.isArray(msg.list) ? msg.list : []);
        break;

      case 'session_init':
        sessionReady = false;
        if (sessionStatus) {
          cancelSessionStatusHide();
          sessionStatus.classList.remove('hidden', 'ready');
          sessionStatus.classList.add('loading');
          setSessionStatus(SVG_SPINNER, randomFrom(INIT_MESSAGES));
        }
        break;

      case 'session_ready':
        // stale session_ready vom vorherigen vault ignorieren, kann bei schnellem
        // switch passieren, wenn der alte warmup erst nach dem neuen fertig wird
        if (typeof msg.toolPrefix === 'string' && activeVaultPrefix && msg.toolPrefix !== activeVaultPrefix) {
          break;
        }
        sessionReady = true;
        cancelled = false;
        reconnectAttempts = 0;
        clearReconnectNotice();
        if (typeof msg.toolPrefix === 'string') activeVaultPrefix = msg.toolPrefix;
        if (isChat) setInputEnabled(true);
        if (sessionStatus) {
          // alten timer abbrechen (z.b. von vorherigem ready vor vault-switch)
          cancelSessionStatusHide();
          sessionStatus.classList.remove('loading', 'hidden');
          sessionStatus.classList.add('ready');
          setSessionStatus(SVG_CHECK, 'Bereit');
          scheduleSessionStatusHide();
        }
        landingInput.disabled = false;
        landingInput.placeholder = buildInputPlaceholder();
        landingInput.focus();
        break;

      case 'chunk':
        if (typeof msg.content !== 'string') break;
        if (!currentAiMsg) {
          currentAiMsg = appendAiMessage();
          currentAiText = '';
        }
        removeThinking(currentAiMsg);
        startResponseTimeout();
        textBuffer += msg.content;
        startTypewriter();
        break;

      case 'tool_use':
        if (!msg.tool || !msg.status) break;
        if (!currentAiMsg) {
          currentAiMsg = appendAiMessage();
          currentAiText = '';
        }
        removeThinking(currentAiMsg);
        startResponseTimeout();
        handleToolUse(msg);
        scrollToBottom();
        break;

      case 'done':
        clearResponseTimeout();
        finishResponse(messageId);
        break;

      case 'report_saved':
        reportPending = false;
        if (!reportOverlay.classList.contains('hidden')) {
          // overlay offen lassen + feld leeren: wer aktiv testet, findet mehrere
          // bugs hintereinander und soll sie ohne neu-öffnen melden können
          reportText.value = '';
          reportSend.disabled = true;
          showReportSuccess('Gespeichert, danke! Du kannst direkt den nächsten Bug melden.');
          reportText.focus();
        } else {
          appendSystemMessage('Bug-Report gespeichert. Danke!');
        }
        break;

      case 'error': {
        const errMsg = typeof msg.message === 'string' ? msg.message : 'Unbekannter Fehler';
        // fehler während ein report läuft: im overlay zeigen statt im chat verstecken
        if (reportPending && !reportOverlay.classList.contains('hidden')) {
          reportPending = false;
          showReportError(errMsg);
          break;
        }
        // laufenden tool-block sauber beenden (finalizeActiveResponse), dann fehler zeigen
        finalizeActiveResponse();
        appendError(errMsg);
        setInputEnabled(true);
        break;
      }

    }
  }

  function sendMessage(text) {
    text = text.trim();
    if (!text || !ws || ws.readyState !== WebSocket.OPEN || !sessionReady) return;

    // längencheck VOR jeglicher ui-mutation: sonst geht die nachricht verloren,
    // wenn der server sie ablehnt (bubble wäre schon weg, input geleert)
    if (text.length > MAX_MESSAGE_LENGTH) {
      showLengthHint(text.length);
      return;
    }
    clearLengthHint();

    if (!isChat) {
      switchToChat();
    }

    lockVaultSelector();
    appendUserMessage(text);

    const mode = getActiveSpeed().dataset.mode;
    ws.send(JSON.stringify({ type: 'message', content: text, mode: mode }));

    messageId++;
    // sofort eine ai-bubble mit denkt-indikator zeigen, damit klar ist dass
    // gearbeitet wird, auch während warm-up/erstem tool-call noch nichts zurückkommt
    currentAiMsg = appendAiMessage();
    currentAiText = '';
    showThinking(currentAiMsg);
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
    const v = activeVault();
    if (v && vaults.length >= 2 && chatInput) {
      chatInput.placeholder = 'Was willst du zu ' + v.name + ' wissen?';
    }
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

  // denkt-indikator in eine frische ai-bubble setzen. wird vom ersten chunk oder
  // tool_use wieder entfernt. liegt vor der msg-content, damit renderAiContent
  // (das nur die msg-content füllt) ihn nicht überschreibt.
  function showThinking(aiMsg) {
    if (!aiMsg || aiMsg.querySelector('.thinking-indicator')) return;
    const ind = document.createElement('div');
    ind.className = 'thinking-indicator';
    ind.innerHTML = '<span class="thinking-dots"><span></span><span></span><span></span></span>'
      + '<span class="thinking-label">Suche in der Dokumentation...</span>';
    aiMsg.insertBefore(ind, aiMsg.firstChild);
  }

  function removeThinking(aiMsg) {
    if (!aiMsg) return;
    const ind = aiMsg.querySelector('.thinking-indicator');
    if (ind) ind.remove();
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
    // text-buffer immer weiterschieben, aber nur gedrosselt rendern
    if (Date.now() - lastRenderTs >= RENDER_MS) {
      renderAiContent();
      scrollToBottom();
    }
  }

  function flushTypewriter() {
    if (typewriterTimer) {
      clearInterval(typewriterTimer);
      typewriterTimer = null;
    }
    if (textBuffer.length > 0) {
      currentAiText += textBuffer;
      textBuffer = '';
    }
    // immer final rendern, auch wenn der buffer leer war (gedrosselte ticks
    // könnten den letzten stand sonst ausgelassen haben)
    if (currentAiText) {
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
      // immer final flushen/rendern: durch das render-throttling können die letzten
      // zeichen im currentAiText hängen ohne im dom zu sein
      flushTypewriter();

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
      contentEl.innerHTML = sanitizeMarkdown(currentAiText);
    }
    lastRenderTs = Date.now();
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
    const label = toolLabel(msg.tool, TOOL_LABELS) || 'Verarbeite Anfrage';

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
        const doneLabel = toolLabel(msg.tool, TOOL_DONE_LABELS) || 'Anfrage verarbeitet';
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
    if (!container) return;
    container.querySelectorAll('pre code').forEach(function (block) {
      if (window.hljs) hljs.highlightElement(block);
      addCopyButton(block.parentElement);
    });
  }

  // copy-button oben rechts an jeden codeblock. idempotent, click läuft über
  // delegation auf messagesEl (siehe unten).
  function addCopyButton(pre) {
    if (!pre || pre.tagName !== 'PRE' || pre.querySelector('.code-copy-btn')) return;
    const btn = document.createElement('button');
    btn.className = 'code-copy-btn';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Code kopieren');
    btn.innerHTML = SVG_COPY + '<span>Kopieren</span>';
    pre.appendChild(btn);
  }

  function setCopyBtnState(btn, ok) {
    btn.classList.remove('copied', 'failed');
    btn.classList.add(ok ? 'copied' : 'failed');
    btn.innerHTML = (ok ? SVG_CHECK : SVG_COPY) + '<span>' + (ok ? 'Kopiert' : 'Fehler') + '</span>';
    setTimeout(function () {
      btn.classList.remove('copied', 'failed');
      btn.innerHTML = SVG_COPY + '<span>Kopieren</span>';
    }, 1500);
  }

  function copyCode(text, btn) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () { setCopyBtnState(btn, true); },
        function () { setCopyBtnState(btn, fallbackCopy(text)); }
      );
    } else {
      setCopyBtnState(btn, fallbackCopy(text));
    }
  }

  // fallback fuer non-secure-context (http ueber IP), wo navigator.clipboard fehlt
  function fallbackCopy(text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) {
      return false;
    }
  }

  // copy-button-klicks delegiert (buttons werden dynamisch pro antwort erzeugt)
  messagesEl.addEventListener('click', function (e) {
    const btn = e.target.closest('.code-copy-btn');
    if (!btn || !messagesEl.contains(btn)) return;
    const pre = btn.closest('pre');
    if (!pre) return;
    const code = pre.querySelector('code');
    copyCode(code ? code.textContent : pre.textContent, btn);
  });

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
    finalizeActiveResponse();
    if (ws) {
      // bewusster close: onclose soll keinen reconnect auslösen
      intentionalClose = true;
      ws.close();
    }
    sessionReady = false;
    connect();
    // cancelled bleibt true: das blockt nur noch streaming-events (siehe handleEvent).
    // das frische session_ready des neuen sockets setzt cancelled wieder false und
    // gibt den input frei. lifecycle-events sind nicht mehr gegated, also kommt das
    // ready durch (genau der bug der den chat vorher gebrickt hat).
  }

  function getActiveSpeed() {
    return isChat ? chatSpeed : landingSpeed;
  }

  function getActiveInput() {
    return isChat ? chatInput : landingInput;
  }

  function showLengthHint(len) {
    const input = getActiveInput();
    const box = input.closest('.input-box');
    if (!box) return;
    let hint = box.querySelector('.length-hint');
    if (!hint) {
      hint = document.createElement('div');
      hint.className = 'length-hint';
      box.appendChild(hint);
    }
    hint.textContent = 'Nachricht zu lang: ' + len + ' / ' + MAX_MESSAGE_LENGTH + ' Zeichen';
  }

  function clearLengthHint() {
    document.querySelectorAll('.length-hint').forEach(function (el) {
      el.remove();
    });
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
    if (this.value.trim().length <= MAX_MESSAGE_LENGTH) clearLengthHint();
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
    if (this.value.trim().length <= MAX_MESSAGE_LENGTH) clearLengthHint();
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
    // bewusster reload: socket-close soll keinen reconnect-flash auslösen
    intentionalClose = true;
    location.reload();
  });

  const SVG_SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';
  const SVG_MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';

  function updateThemeButtons() {
    var isLight = document.documentElement.getAttribute('data-theme') === 'light';
    var icon = isLight ? SVG_MOON : SVG_SUN;
    var title = isLight ? 'Dark Mode' : 'Light Mode';
    btnTheme.innerHTML = icon;
    btnTheme.title = title;
    landingTheme.innerHTML = icon;
    landingTheme.title = title;
  }

  function toggleTheme() {
    var isLight = document.documentElement.getAttribute('data-theme') === 'light';
    var newTheme = isLight ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    hljsTheme.href = newTheme === 'light'
      ? 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css'
      : 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css';
    updateThemeButtons();
  }

  btnTheme.addEventListener('click', toggleTheme);
  landingTheme.addEventListener('click', toggleTheme);

  updateThemeButtons();

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
    clearReportError();
  });

  reportOverlay.addEventListener('click', function (e) {
    if (e.target === reportOverlay) closeReportOverlay();
  });

  const reportError = document.getElementById('report-error');

  function openReportOverlay() {
    reportText.value = '';
    reportSend.disabled = true;
    reportPending = false;
    clearReportError();
    reportOverlay.classList.remove('hidden');
    reportText.focus();
  }

  function closeReportOverlay() {
    reportPending = false;
    reportOverlay.classList.add('hidden');
  }

  function showReportError(text) {
    // fehler im overlay anzeigen und senden wieder freigeben statt overlay zu blocken
    if (reportError) {
      reportError.textContent = text;
      reportError.classList.remove('hidden', 'success');
    }
    reportSend.disabled = !reportText.value.trim();
  }

  // bestätigung im overlay (grün) statt das overlay zu schließen, damit man
  // direkt den nächsten report tippen kann
  function showReportSuccess(text) {
    if (reportError) {
      reportError.textContent = text;
      reportError.classList.remove('hidden');
      reportError.classList.add('success');
    }
  }

  function clearReportError() {
    if (reportError) {
      reportError.textContent = '';
      reportError.classList.add('hidden');
      reportError.classList.remove('success');
    }
  }

  function submitReport() {
    const desc = reportText.value.trim();
    if (!desc || !ws || ws.readyState !== WebSocket.OPEN) return;

    clearReportError();

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

    reportPending = true;
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
