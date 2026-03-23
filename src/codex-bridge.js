import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

const SYSTEM_PROMPT = [
  'Du bist ein Assistent für die otris DOCUMENTS Dokumentation.',
  'Du hast Zugriff auf otris-docs MCP Tools (otris_search, otris_read, otris_list, otris_overview).',
  'Nutze die Tools NUR wenn der User eine konkrete Frage zur Dokumentation hat.',
  'Bei Rückfragen, Klarstellungen oder einfachen Antworten: antworte direkt ohne Tools.',
  'Antworte auf Deutsch. Halte Antworten kurz und präzise.'
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
    const bridge = this;
    const history = [];

    return {
      id,
      get destroyed() { return destroyed; },

      async *send(content, mode) {
        if (destroyed) throw new Error('Session destroyed');

        history.push({ role: 'user', content });

        // vorherige nachrichten als context (nur letzte 4 nachrichten)
        let fullPrompt = content;
        if (history.length > 2) {
          const recent = history.slice(-5, -1);
          const context = recent.map(m =>
            m.role === 'user' ? `User: ${m.content}` : `Assistant: ${m.content}`
          ).join('\n\n');
          fullPrompt = `Bisheriger Verlauf:\n${context}\n\nUser: ${content}`;
        }

        yield { type: 'tool_use', tool: 'otris_search', status: 'running' };

        try {
          const startTime = Date.now();
          const result = await new Promise((resolve, reject) => {
            const args = ['-p', '--output-format', 'text', '--system-prompt', SYSTEM_PROMPT];

            if (mode === 'fast') {
              args.push('--model', 'sonnet');
              args.push('--max-turns', '2');
            } else {
              args.push('--max-turns', '5');
            }

            console.log(`[claude] mode=${mode}, prompt: ${content.substring(0, 80)}`);

            const proc = spawn('claude', args, {
              stdio: ['pipe', 'pipe', 'pipe'],
              cwd: MCP_CWD,
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
              const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
              console.log(`[claude] fertig in ${elapsed}s, ${stdout.length} chars`);
              if (code !== 0) {
                reject(new Error(stderr || `claude exited with code ${code}`));
              } else {
                resolve(stdout.trim());
              }
            });

            proc.on('error', reject);

            proc.stdin.write(fullPrompt);
            proc.stdin.end();
          });

          yield { type: 'tool_use', tool: 'otris_search', status: 'done' };

          // antwort in chunks für streaming-effekt
          const chunkSize = 50;
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
