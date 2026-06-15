export class SessionManager {
  #sessions = new Map();
  #rateCounts = new Map();
  #bridge;
  #config;
  #cleanupInterval;

  constructor(bridge, config = {}) {
    this.#bridge = bridge;
    this.#config = {
      maxSessions: config.maxSessions ?? 50,
      rateLimitPerMin: config.rateLimitPerMin ?? 10,
      maxMessageLength: config.maxMessageLength ?? 2000,
    };

    this.#cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [ip, entry] of this.#rateCounts) {
        if (now > entry.resetAt) this.#rateCounts.delete(ip);
      }
    }, 60000);
  }

  get sessionCount() {
    return this.#sessions.size;
  }

  async createAndWarmUp(clientId, toolPrefix) {
    // synchroner platzhalter gegen race condition bei bursts
    if (this.#sessions.size >= this.#config.maxSessions) {
      throw new Error('Max sessions reached');
    }
    // abort-controller auf dem platzhalter, damit removeSession einen laufenden
    // build abbrechen kann statt nur den map-eintrag zu droppen.
    const abortController = new AbortController();
    const placeholder = { ready: false, destroyed: false, toolPrefix, abortController };
    this.#sessions.set(clientId, placeholder);

    let session;
    let cleanedUp = false;
    try {
      session = await this.#bridge.createSession(toolPrefix);
      // ownership-check: wurde der platzhalter zwischenzeitlich ersetzt (anderer
      // vault gewählt) oder via removeSession abgebrochen, gehört uns der slot
      // nicht mehr. session zerstören statt überschreiben, damit keine
      // subprocesses leaken und nicht der falsche vault gewinnt.
      if (this.#sessions.get(clientId) !== placeholder || abortController.signal.aborted) {
        cleanedUp = true;
        if (session?.destroy) { try { await session.destroy(); } catch {} }
        throw new Error('Session superseded');
      }
      session.toolPrefix = toolPrefix;
      this.#sessions.set(clientId, session);
      await session.warmUp();
      // ownership-check nach warmUp: ein später auflösender build darf die vom
      // user tatsächlich gewählte session nicht mehr klobbern.
      if (this.#sessions.get(clientId) !== session || abortController.signal.aborted) {
        cleanedUp = true;
        if (session?.destroy) { try { await session.destroy(); } catch {} }
        throw new Error('Session superseded');
      }
      return session;
    } catch (err) {
      // nur aufräumen wenn der slot noch uns gehört (platzhalter oder unsere
      // session). sonst haben wir oben schon zerstört oder ein anderer call besitzt
      // den slot und darf nicht angefasst werden.
      const current = this.#sessions.get(clientId);
      if (current === placeholder || current === session) {
        this.#sessions.delete(clientId);
      }
      if (!cleanedUp && session?.destroy) {
        try { await session.destroy(); } catch {}
      }
      throw err;
    }
  }

  hasSession(clientId) {
    return this.#sessions.has(clientId);
  }

  getSessionRaw(clientId) {
    return this.#sessions.get(clientId);
  }

  getSession(clientId) {
    const session = this.#sessions.get(clientId);
    if (!session || session.ready === false) return null;
    return session;
  }

  async removeSession(clientId) {
    const session = this.#sessions.get(clientId);
    this.#sessions.delete(clientId);
    // laufenden build (createSession/warmUp) abbrechen. der ownership-guard in
    // createAndWarmUp sieht das abgebrochene signal und zerstört die session.
    if (session?.abortController) {
      try { session.abortController.abort(); } catch {}
    }
    if (session && typeof session.destroy === 'function') {
      await session.destroy();
    }
  }

  validateMessage(content) {
    if (content == null) {
      throw new Error('Nachricht darf nicht leer sein');
    }
    if (typeof content !== 'string') {
      throw new Error('Nachricht muss ein String sein');
    }
    if (content.trim().length === 0) {
      throw new Error('Nachricht darf nicht leer sein');
    }
    if (content.length > this.#config.maxMessageLength) {
      throw new Error(`Nachricht zu lang (max ${this.#config.maxMessageLength} Zeichen)`);
    }
  }

  checkRateLimit(ip) {
    const now = Date.now();
    let entry = this.#rateCounts.get(ip);
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + 60000 };
      this.#rateCounts.set(ip, entry);
    }
    entry.count++;
    if (entry.count > this.#config.rateLimitPerMin) {
      throw new Error('Du bist gerade etwas zu schnell unterwegs. Warte einen Moment.');
    }
  }

  async shutdown() {
    clearInterval(this.#cleanupInterval);
    const ids = [...this.#sessions.keys()];
    await Promise.allSettled(ids.map(id => this.removeSession(id)));
  }
}
