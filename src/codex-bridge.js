import { randomUUID } from 'node:crypto';

function isAuthError(err) {
  const msg = (err?.message || '').toLowerCase();
  return msg.includes('auth') || msg.includes('token') || msg.includes('unauthorized') || msg.includes('api key');
}

const AUTH_USER_MSG = 'Service temporär nicht verfügbar. Bitte später erneut versuchen.';

export class CodexBridge {
  getReasoningEffort(mode) {
    return mode === 'fast' ? 'low' : 'high';
  }

  async createSession(sdk) {
    try {
      if (!sdk) {
        sdk = await import('@openai/codex-sdk');
      }
    } catch (err) {
      if (isAuthError(err)) {
        throw new Error(AUTH_USER_MSG);
      }
      throw err;
    }

    let thread;
    try {
      thread = await sdk.startThread();
    } catch (err) {
      if (isAuthError(err)) {
        throw new Error(AUTH_USER_MSG);
      }
      throw err;
    }

    const id = randomUUID();
    let destroyed = false;
    const bridge = this;

    return {
      id,
      get destroyed() { return destroyed; },

      async *send(content, mode) {
        if (destroyed) throw new Error('Session destroyed');

        const effort = bridge.getReasoningEffort(mode);
        let stream;
        try {
          stream = thread.runStreamed(content, { reasoning_effort: effort });
        } catch (err) {
          if (isAuthError(err)) {
            yield { type: 'error', message: AUTH_USER_MSG };
            return;
          }
          throw err;
        }

        let done = false;

        for await (const event of stream) {
          // event-typen müssen in Task 7 gegen die echte SDK-Doku verifiziert werden
          if (event.type === 'tool_use') {
            yield { type: 'tool_use', tool: event.name, status: 'running' };
          } else if (event.type === 'tool_result') {
            yield { type: 'tool_use', tool: event.name, status: 'done' };
          } else if (event.type === 'text_delta') {
            yield { type: 'chunk', content: event.text };
          } else if (event.type === 'turn_completed') {
            done = true;
            yield { type: 'done' };
          } else if (event.type === 'error') {
            const msg = event.message || 'Unbekannter Fehler';
            if (msg.includes('auth') || msg.includes('token') || msg.includes('unauthorized')) {
              yield { type: 'error', message: AUTH_USER_MSG };
            } else {
              yield { type: 'error', message: msg };
            }
          }
        }

        // fallback: stream endete ohne turn_completed
        if (!done) {
          yield { type: 'done' };
        }
      },

      async destroy() {
        destroyed = true;
      }
    };
  }
}
