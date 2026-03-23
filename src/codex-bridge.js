import { randomUUID } from 'node:crypto';

export class CodexBridge {
  getReasoningEffort(mode) {
    return mode === 'fast' ? 'low' : 'high';
  }

  async createSession() {
    const sdk = await import('@openai/codex-sdk');
    const thread = await sdk.startThread();
    const id = randomUUID();
    let destroyed = false;
    const bridge = this;

    return {
      id,
      get destroyed() { return destroyed; },

      async *send(content, mode) {
        if (destroyed) throw new Error('Session destroyed');

        const effort = bridge.getReasoningEffort(mode);
        const stream = thread.runStreamed(content, { reasoning_effort: effort });

        for await (const event of stream) {
          // event-typen müssen in Task 7 gegen die echte SDK-Doku verifiziert werden
          if (event.type === 'tool_use') {
            yield { type: 'tool_use', tool: event.name, status: 'running' };
          } else if (event.type === 'tool_result') {
            yield { type: 'tool_use', tool: event.name, status: 'done' };
          } else if (event.type === 'text_delta') {
            yield { type: 'chunk', content: event.text };
          } else if (event.type === 'turn_completed') {
            yield { type: 'done' };
          } else if (event.type === 'error') {
            const msg = event.message || 'Unbekannter Fehler';
            if (msg.includes('auth') || msg.includes('token') || msg.includes('unauthorized')) {
              yield { type: 'error', message: 'Service temporär nicht verfügbar. Bitte später erneut versuchen.' };
            } else {
              yield { type: 'error', message: msg };
            }
          }
        }
      },

      async destroy() {
        destroyed = true;
      }
    };
  }
}
