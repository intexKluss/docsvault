import { randomUUID } from 'node:crypto';
import { query } from '@anthropic-ai/claude-agent-sdk';

const SYSTEM_PROMPT = [
  'Du bist ein Assistent für die otris DOCUMENTS Dokumentation.',
  'Du hast Zugriff auf otris-docs MCP Tools (otris_search, otris_read, otris_list, otris_overview).',
  'Nutze die Tools wenn der User eine konkrete Frage zur Dokumentation hat.',
  'Bei Rückfragen oder Klarstellungen: antworte direkt ohne Tools.',
  'Antworte auf Deutsch. Halte Antworten kurz und präzise. Gib Code-Beispiele wenn möglich.'
].join(' ');

// verzeichnis wo .mcp.json liegt
const MCP_CWD = 'C:\\Users\\m.kluss\\ai';

export class CodexBridge {
  getReasoningEffort(mode) {
    return mode === 'fast' ? 'low' : 'high';
  }

  async createSession() {
    const id = randomUUID();
    let destroyed = false;
    let sessionId = null;

    return {
      id,
      get destroyed() { return destroyed; },

      async *send(content, mode) {
        if (destroyed) throw new Error('Session destroyed');

        const model = mode === 'fast' ? 'claude-sonnet-4-6' : 'claude-opus-4-6';

        console.log(`[claude-sdk] mode=${mode}, model=${model}, session=${sessionId || 'new'}`);
        console.log(`[claude-sdk] prompt: ${content.substring(0, 80)}`);
        const startTime = Date.now();

        let toolRunning = false;

        try {
          const options = {
            model,
            cwd: MCP_CWD,
            systemPrompt: SYSTEM_PROMPT,
            allowedTools: [
              'mcp__otris-docs__otris_search',
              'mcp__otris-docs__otris_read',
              'mcp__otris-docs__otris_list',
              'mcp__otris-docs__otris_overview',
              'mcp__otris-docs__otris_status'
            ],
            maxTurns: mode === 'fast' ? 3 : 6,
          };

          // session fortsetzen wenn vorhanden
          if (sessionId) {
            options.resume = sessionId;
          }

          for await (const message of query({ prompt: content, options })) {
            // session id speichern
            if (message.type === 'system' && message.subtype === 'init' && message.session_id) {
              sessionId = message.session_id;
              console.log(`[claude-sdk] session_id: ${sessionId}`);
            }

            // tool usage
            if (message.type === 'assistant' && message.message?.content) {
              for (const block of message.message.content) {
                if (block.type === 'tool_use' && !toolRunning) {
                  toolRunning = true;
                  const toolName = block.name?.replace('mcp__otris-docs__', '') || 'otris_search';
                  yield { type: 'tool_use', tool: toolName, status: 'running' };
                }
                if (block.type === 'text' && block.text) {
                  if (toolRunning) {
                    yield { type: 'tool_use', tool: 'otris_search', status: 'done' };
                    toolRunning = false;
                  }
                  yield { type: 'chunk', content: block.text };
                }
              }
            }

            // tool result
            if (message.type === 'tool') {
              if (toolRunning) {
                yield { type: 'tool_use', tool: 'otris_search', status: 'done' };
                toolRunning = false;
              }
            }

            // final result
            if (message.type === 'result') {
              if (toolRunning) {
                yield { type: 'tool_use', tool: 'otris_search', status: 'done' };
                toolRunning = false;
              }
              if (message.subtype === 'success' && message.result) {
                yield { type: 'chunk', content: message.result };
              }
              if (message.subtype === 'error') {
                yield { type: 'error', message: message.error || 'Unbekannter Fehler' };
              }
            }
          }

          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(`[claude-sdk] fertig in ${elapsed}s`);

          yield { type: 'done' };
        } catch (err) {
          if (toolRunning) {
            yield { type: 'tool_use', tool: 'otris_search', status: 'done' };
          }
          console.error(`[claude-sdk] error: ${err.message}`);
          yield { type: 'error', message: err.message || 'Fehler bei der Verarbeitung' };
        }
      },

      async destroy() {
        destroyed = true;
        sessionId = null;
      }
    };
  }
}
