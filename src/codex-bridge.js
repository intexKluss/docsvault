import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

const SYSTEM_PROMPT = `Du bist ein Assistent für die otris DOCUMENTS Dokumentation.
Nutze IMMER die otris-docs MCP Tools (otris_search, otris_read, otris_list, otris_overview) um Fragen zu beantworten.
Durchsuche zuerst die Dokumentation mit otris_search, dann lies relevante Seiten mit otris_read.
Antworte auf Deutsch. Gib Code-Beispiele wenn möglich.
Wenn du keine relevante Dokumentation findest, sage das ehrlich.`;

export class CodexBridge {
  getReasoningEffort(mode) {
    return mode === 'fast' ? 'low' : 'high';
  }

  async createSession() {
    const id = randomUUID();
    let destroyed = false;
    const bridge = this;
    // conversation history für context
    const history = [];

    return {
      id,
      get destroyed() { return destroyed; },

      async *send(content, mode) {
        if (destroyed) throw new Error('Session destroyed');

        history.push({ role: 'user', content });

        // system prompt mit context aus vorherigen nachrichten
        let prompt = content;
        if (history.length > 2) {
          // vorherige nachrichten als context mitgeben
          const context = history.slice(0, -1).map(m =>
            m.role === 'user' ? `User: ${m.content}` : `Assistant: ${m.content}`
          ).join('\n\n');
          prompt = `Bisheriger Konversationsverlauf:\n${context}\n\nAktuelle Frage: ${content}`;
        }

        yield { type: 'tool_use', tool: 'otris_search', status: 'running' };

        const effort = bridge.getReasoningEffort(mode);

        try {
          const result = await new Promise((resolve, reject) => {
            const args = ['-p', '--output-format', 'text', '--system-prompt', SYSTEM_PROMPT];

            // model basierend auf mode
            if (mode === 'fast') {
              args.push('--model', 'sonnet');
            }

            args.push(prompt);

            const proc = spawn('claude', args, {
              stdio: ['pipe', 'pipe', 'pipe'],
              shell: true,
              env: { ...process.env }
            });

            let stdout = '';
            let stderr = '';

            proc.stdout.on('data', (data) => {
              stdout += data.toString();
            });

            proc.stderr.on('data', (data) => {
              stderr += data.toString();
            });

            proc.on('close', (code) => {
              if (code !== 0) {
                reject(new Error(stderr || `claude exited with code ${code}`));
              } else {
                resolve(stdout.trim());
              }
            });

            proc.on('error', (err) => {
              reject(err);
            });
          });

          yield { type: 'tool_use', tool: 'otris_search', status: 'done' };

          // antwort in chunks aufteilen für streaming-effekt
          const chunkSize = 20;
          for (let i = 0; i < result.length; i += chunkSize) {
            yield { type: 'chunk', content: result.slice(i, i + chunkSize) };
          }

          history.push({ role: 'assistant', content: result });
          yield { type: 'done' };
        } catch (err) {
          yield { type: 'tool_use', tool: 'otris_search', status: 'done' };
          yield { type: 'error', message: err.message || 'Fehler bei der Verarbeitung' };
        }
      },

      async destroy() {
        destroyed = true;
      }
    };
  }
}
