import { randomUUID } from 'node:crypto';
import { Codex } from '@openai/codex-sdk';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSystemPrompt } from './system-prompt.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MCP_CWD = resolve(__dirname, '..');

// ausführliches session-logging fürs debugging. CODEX_DEBUG=1 schaltet zusätzlich
// jedes roh-event frei (sehr gesprächig), sonst nur tool-calls, modell und fehler.
const CODEX_DEBUG = process.env.CODEX_DEBUG === '1' || process.env.CODEX_DEBUG === 'true';

// langen text fürs log kappen, damit eine zeile lesbar bleibt
function truncate(v, n = 300) {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s && s.length > n ? s.slice(0, n) + '…' : (s || '');
}

// tool-argumente knapp anzeigen. je nach sdk-version liegen sie unter
// arguments/input/args, drum defensiv lesen statt auf ein feld zu wetten.
function previewToolArgs(item) {
  const raw = item?.arguments ?? item?.input ?? item?.args;
  if (raw == null) return '';
  return ' args=' + truncate(raw, 120);
}

export class CodexBridge {
  constructor(vaultRegistry) {
    this.vaultRegistry = (vaultRegistry || []).filter(
      v => v && typeof v.toolPrefix === 'string' && v.toolPrefix.length > 0
    );
  }

  async createSession(toolPrefix) {
    const id = randomUUID();
    let registry = this.vaultRegistry;
    if (toolPrefix) {
      const scoped = registry.find(v => v.toolPrefix === toolPrefix);
      if (!scoped) throw new Error(`Unknown vault: ${toolPrefix}`);
      registry = [scoped];
    }
    const systemPrompt = buildSystemPrompt(registry);
    let destroyed = false;
    let warmedUp = false;
    let warmingUp = false;
    let activeAbort = null;
    let codex = new Codex({
      codexPathOverride: process.env.CODEX_PATH,
    });
    const model = process.env.CODEX_MODEL || 'gpt-5.4';
    // reasoning-modelle (gpt-5.5) denken sonst voll durch -> sehr langsam. low
    // reicht für doku-suche + formulieren locker. tunebar: minimal..xhigh.
    const reasoningEffort = process.env.CODEX_REASONING_EFFORT || 'low';
    let thread = codex.startThread({
      model,
      modelReasoningEffort: reasoningEffort,
      // docsvault sucht nur in den otris-mcp-tools, kein web. ausschalten, sonst
      // bricht reasoning-effort 'minimal' (web_search ist mit minimal inkompatibel).
      webSearchEnabled: false,
      webSearchMode: 'disabled',
      workingDirectory: MCP_CWD,
      sandboxMode: 'read-only',
      approvalPolicy: 'never',
      skipGitRepoCheck: true,
    });
    console.log(`[codex-sdk] session ${id} angelegt, model=${model} (reasoning=${reasoningEffort}), vaults=[${registry.map(v => v.toolPrefix).join(',')}]`);

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
          await thread.run(systemPrompt + '\n\nAntworte nur mit: Bereit.', {
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
          console.error(`[codex-sdk] ${id} warm-up error: ${err.message}`);
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
          : '[SCHNELL] Der Nutzer will eine schnelle, knappe Antwort. Such fokussiert statt planlos breit: nimm die API-Referenz als Leitquelle und lies sie wirklich, statt dutzendfach quer zu suchen. WICHTIGER als die Geschwindigkeit ist Konsistenz: entscheide dich für EINEN, den aktuellen API-Stil und ziehe ihn in der ganzen Antwort durch. Mische niemals Varianten (mal formGadget.addX, mal form.addX, mal mit/ohne context.enableModules).\n\n';

        const fullPrompt = modePrefix + content;

        console.log(`[codex-sdk] ${id} frage (mode=${mode}, model=${model}): "${truncate(content, 100)}"`);
        const startTime = Date.now();

        const abort = new AbortController();
        activeAbort = abort;
        let toolRunning = false;
        let currentToolName = null;
        let lastMessage = null;
        let toolCalls = 0;
        let answerChars = 0;

        try {
          const { events } = await thread.runStreamed(fullPrompt, {
            signal: abort.signal,
          });

          for await (const event of events) {
            if (destroyed || abort.signal.aborted) {
              console.log(`[codex-sdk] ${id} schleife abgebrochen (destroyed=${destroyed}, aborted=${abort.signal.aborted}) nach ${toolCalls} tool-calls`);
              break;
            }

            // roh-event-trace nur mit CODEX_DEBUG, sonst zu gesprächig
            if (CODEX_DEBUG) {
              console.log(`[codex-sdk] ${id} event: ${event.type}${event.item?.type ? '/' + event.item.type : ''}`);
            }

            if (event.type === 'item.started' && event.item.type === 'mcp_tool_call') {
              toolRunning = true;
              toolCalls++;
              currentToolName = event.item.tool || 'unknown';
              console.log(`[codex-sdk] ${id} tool-start #${toolCalls}: ${currentToolName}${previewToolArgs(event.item)}`);
              yield { type: 'tool_use', tool: currentToolName, status: 'running' };
            }

            if (event.type === 'item.completed' && event.item.type === 'mcp_tool_call') {
              const toolErr = event.item.error || event.item.is_error;
              console.log(`[codex-sdk] ${id} tool-done: ${currentToolName}` + (toolErr ? ` FEHLER: ${truncate(toolErr)}` : ' ok'));
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
              answerChars += (event.item.text || '').length;
            }

            if (event.type === 'turn.completed') {
              if (lastMessage) {
                yield { type: 'chunk', content: lastMessage };
                lastMessage = null;
              }
            }

            if (event.type === 'error') {
              console.error(`[codex] ${id} error-event:`, truncate(event.message || event));
              yield { type: 'error', message: 'Fehler bei der Verarbeitung. Bitte versuche es erneut.' };
            }

            if (event.type === 'turn.failed') {
              console.error(`[codex] ${id} turn.failed:`, truncate(event.error?.message || event.error || event));
              yield { type: 'error', message: 'Anfrage fehlgeschlagen. Bitte versuche es erneut.' };
            }
          }

          if (toolRunning) {
            yield { type: 'tool_use', tool: currentToolName, status: 'done' };
          }

          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(`[codex-sdk] ${id} fertig in ${elapsed}s, ${toolCalls} tool-calls, ${answerChars} antwort-zeichen`);

          yield { type: 'done' };
        } catch (err) {
          if (toolRunning) {
            yield { type: 'tool_use', tool: currentToolName, status: 'done' };
          }
          if (abort.signal.aborted) {
            console.log(`[codex-sdk] ${id} query abgebrochen nach ${toolCalls} tool-calls`);
            return;
          }
          console.error(`[codex-sdk] ${id} error nach ${toolCalls} tool-calls: ${err.message}`);
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
