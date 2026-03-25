import { randomUUID } from 'node:crypto';
import { Codex } from '@openai/codex-sdk';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SYSTEM_PROMPT } from './system-prompt.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MCP_CWD = resolve(__dirname, '..');

export class CodexBridge {
  async createSession() {
    const id = randomUUID();    
    let destroyed = false;
    let warmedUp = false;
    let warmingUp = false;
    let activeAbort = null;
    let codex = new Codex({
      codexPathOverride: process.env.CODEX_PATH,
    });
    let thread = codex.startThread({
      model: process.env.CODEX_MODEL || 'gpt-5.4',
      workingDirectory: MCP_CWD,
      sandboxMode: 'read-only',
      approvalPolicy: 'never',
      skipGitRepoCheck: true,
    });

    return {
      id,
      get destroyed() { return destroyed; },
      get ready() { return warmedUp; },

      async warmUp() {
        if (destroyed || warmedUp || warmingUp) return;
        warmingUp = true;

        console.log(`[codex-sdk] warming up session ${id}...`);
        const startTime = Date.now();

        const abort = new AbortController();
        activeAbort = abort;

        try {
          await thread.run(SYSTEM_PROMPT + '\n\nAntworte nur mit: Bereit.', {
            signal: abort.signal,
          });
          if (destroyed) return;
          warmedUp = true;
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(`[codex-sdk] warm-up fertig in ${elapsed}s, thread=${thread.id}`);
        } catch (err) {
          if (abort.signal.aborted) {
            console.log(`[codex-sdk] warm-up abgebrochen`);
            return;
          }
          console.error(`[codex-sdk] warm-up error: ${err.message}`);
          throw err;
        } finally {
          activeAbort = null;
          warmingUp = false;
        }
      },

      async *send(content, mode) {
        if (destroyed) throw new Error('Session destroyed');
        if (!warmedUp) throw new Error('Session not ready');
        if (typeof content !== 'string' || !content.trim()) throw new Error('Invalid content');

        const modePrefix = mode === 'thorough'
          ? '[GRÜNDLICH] Recherchiere gründlich. Lies relevante Dokumente komplett. Prüfe ob deine Antwort wirklich korrekt und vollständig ist. Gib ausführliche Erklärungen mit Code-Beispielen.\n\n'
          : '[SCHNELL] Antworte kurz und präzise. Suche gezielt, nicht breit.\n\n';

        const fullPrompt = modePrefix + content;

        console.log(`[codex-sdk] mode=${mode}, thread=${thread.id || 'new'}`);
        const startTime = Date.now();

        const abort = new AbortController();
        activeAbort = abort;
        let toolRunning = false;
        let currentToolName = null;
        let lastMessage = null;

        try {
          const { events } = await thread.runStreamed(fullPrompt, {
            signal: abort.signal,
          });

          for await (const event of events) {
            if (destroyed || abort.signal.aborted) break;

            if (event.type === 'item.started' && event.item.type === 'mcp_tool_call') {
              toolRunning = true;
              currentToolName = event.item.tool || 'unknown';
              yield { type: 'tool_use', tool: currentToolName, status: 'running' };
            }

            if (event.type === 'item.completed' && event.item.type === 'mcp_tool_call') {
              if (toolRunning) {
                yield { type: 'tool_use', tool: currentToolName, status: 'done' };
                toolRunning = false;
              }
            }

            if (event.type === 'item.completed' && event.item.type === 'agent_message') {
              if (toolRunning) {
                yield { type: 'tool_use', tool: currentToolName, status: 'done' };
                toolRunning = false;
              }
              lastMessage = event.item.text;
            }

            if (event.type === 'turn.completed') {
              if (lastMessage) {
                yield { type: 'chunk', content: lastMessage };
                lastMessage = null;
              }
            }

            if (event.type === 'error') {
              console.error('[codex] Error:', event.message);
              yield { type: 'error', message: 'Fehler bei der Verarbeitung. Bitte versuche es erneut.' };
            }

            if (event.type === 'turn.failed') {
              console.error('[codex] Turn failed:', event.error?.message);
              yield { type: 'error', message: 'Anfrage fehlgeschlagen. Bitte versuche es erneut.' };
            }
          }

          if (toolRunning) {
            yield { type: 'tool_use', tool: currentToolName, status: 'done' };
          }

          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(`[codex-sdk] fertig in ${elapsed}s`);

          yield { type: 'done' };
        } catch (err) {
          if (toolRunning) {
            yield { type: 'tool_use', tool: currentToolName, status: 'done' };
          }
          if (abort.signal.aborted) {
            console.log(`[codex-sdk] query abgebrochen`);
            return;
          }
          console.error(`[codex-sdk] error: ${err.message}`);
          yield { type: 'error', message: 'Fehler bei der Verarbeitung. Bitte versuche es erneut.' };
        } finally {
          activeAbort = null;
          if (destroyed) {
            thread = null;
            codex = null;
          }
        }
      },

      async destroy() {
        if (activeAbort) {
          activeAbort.abort();
        }
        destroyed = true;
        warmedUp = false;
        console.log(`[codex-sdk] session ${id} destroyed`);
      }
    };
  }
}
