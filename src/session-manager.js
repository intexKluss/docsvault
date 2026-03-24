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

  // session sofort erstellen und vorwaermen
  async createAndWarmUp(clientId) {
    if (this.#sessions.size >= this.#config.maxSessions) {
      throw new Error('Max sessions reached');
    }
    const session = await this.#bridge.createSession();
    this.#sessions.set(clientId, session);

    // warm-up im hintergrund starten
    await session.warmUp();
    return session;
  }

  getSession(clientId) {
    return this.#sessions.get(clientId) || null;
  }

  async removeSession(clientId) {
    const session = this.#sessions.get(clientId);
    if (session) {
      await session.destroy();
      this.#sessions.delete(clientId);
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
      throw new Error('Rate limit erreicht. Bitte warte kurz.');
    }
  }

  async shutdown() {
    clearInterval(this.#cleanupInterval);
    const ids = [...this.#sessions.keys()];
    await Promise.allSettled(ids.map(id => this.removeSession(id)));
  }
}
