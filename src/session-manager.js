export class SessionManager {
  #sessions = new Map();
  #removalTimers = new Map();
  #inactivityTimers = new Map();
  #rateCounts = new Map();
  #bridge;
  #config;

  constructor(bridge, config = {}) {
    this.#bridge = bridge;
    this.#config = {
      maxSessions: config.maxSessions ?? 50,
      sessionTimeoutMin: config.sessionTimeoutMin ?? 30,
      rateLimitPerMin: config.rateLimitPerMin ?? 10,
      maxMessageLength: config.maxMessageLength ?? 2000,
    };
  }

  get sessionCount() {
    return this.#sessions.size;
  }

  async getOrCreateSession(clientId) {
    if (this.#sessions.has(clientId)) {
      this.#resetInactivityTimer(clientId);
      return this.#sessions.get(clientId);
    }
    if (this.#sessions.size >= this.#config.maxSessions) {
      throw new Error('Max sessions reached');
    }
    const session = await this.#bridge.createSession();
    this.#sessions.set(clientId, session);
    this.#resetInactivityTimer(clientId);
    return session;
  }

  touchSession(clientId) {
    if (this.#sessions.has(clientId)) {
      this.#resetInactivityTimer(clientId);
    }
  }

  #resetInactivityTimer(clientId) {
    const old = this.#inactivityTimers.get(clientId);
    if (old) clearTimeout(old);
    const ms = this.#config.sessionTimeoutMin * 60 * 1000;
    const timer = setTimeout(() => {
      this.#removeSession(clientId);
    }, ms);
    this.#inactivityTimers.set(clientId, timer);
  }

  scheduleRemoval(clientId, delayMs = 30000) {
    const timer = setTimeout(() => {
      this.#removeSession(clientId);
    }, delayMs);
    this.#removalTimers.set(clientId, timer);
  }

  cancelRemoval(clientId) {
    const timer = this.#removalTimers.get(clientId);
    if (timer) {
      clearTimeout(timer);
      this.#removalTimers.delete(clientId);
    }
  }

  async #removeSession(clientId) {
    const session = this.#sessions.get(clientId);
    if (session) {
      await session.destroy();
      this.#sessions.delete(clientId);
    }
    this.#removalTimers.delete(clientId);
    const inactTimer = this.#inactivityTimers.get(clientId);
    if (inactTimer) clearTimeout(inactTimer);
    this.#inactivityTimers.delete(clientId);
  }

  validateMessage(content) {
    if (content == null) {
      throw new Error('Nachricht darf nicht leer sein');
    }
    if (typeof content !== 'string') {
      throw new Error('Nachricht muss ein String sein');
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
      throw new Error('Rate limit erreicht. Bitte warte kurz.');
    }
  }

  async shutdown() {
    for (const timer of this.#removalTimers.values()) clearTimeout(timer);
    for (const timer of this.#inactivityTimers.values()) clearTimeout(timer);
    const ids = [...this.#sessions.keys()];
    await Promise.allSettled(ids.map(id => this.#removeSession(id)));
  }
}
