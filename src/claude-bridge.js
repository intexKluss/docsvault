import { randomUUID } from 'node:crypto';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSystemPrompt } from './system-prompt.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MCP_CWD = process.env.MCP_CWD || resolve(__dirname, '..');

const MCP_PORT = process.env.PORT || '3000';
const MCP_SSE_URL = process.env.MCP_SSE_URL || `http://localhost:${MCP_PORT}/sse`;

const MCP_SERVERS = {
  'otris-docs': {
    url: MCP_SSE_URL,
  }
};

const DISALLOWED_TOOLS = [
  'Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep',
  'Agent', 'TodoWrite', 'WebSearch', 'WebFetch',
  'NotebookEdit', 'AskUserQuestion', 'EnterPlanMode',
  'ExitPlanMode', 'LSP', 'EnterWorktree', 'ExitWorktree',
  'ToolSearch', 'Skill',
];

export class ClaudeBridge {
  constructor(vaultRegistry) {
    this.vaultRegistry = vaultRegistry || [];
  }

  async createSession() {
    const id = randomUUID();
    let destroyed = false;
    let sessionId = null;
    let warmedUp = false;
    let warmingUp = false;
    let activeAbort = null;

    const registry = this.vaultRegistry;
    const systemPrompt = buildSystemPrompt(registry);
    const allowedTools = registry.flatMap(v => [
      `mcp__otris-docs__${v.toolPrefix}_overview`,
      `mcp__otris-docs__${v.toolPrefix}_search`,
      `mcp__otris-docs__${v.toolPrefix}_read`,
      `mcp__otris-docs__${v.toolPrefix}_list`,
      `mcp__otris-docs__${v.toolPrefix}_status`,
    ]);

    // security-relevante felder NACH spread, nicht überschreibbar
    function buildOptions(overrides = {}) {
      const { model, maxTurns, abortController, resume } = overrides;
      return {
        model: model || 'claude-sonnet-4-6',
        cwd: MCP_CWD,
        mcpServers: MCP_SERVERS,
        pathToClaudeCodeExecutable: process.env.CLAUDE_PATH,
        maxTurns: maxTurns || 6,
        abortController,
        resume,
        systemPrompt,
        allowedTools,
        disallowedTools: DISALLOWED_TOOLS,
      };
    }

    return {
      id,
      get destroyed() { return destroyed; },
      get ready() { return warmedUp; },

      async warmUp() {
        if (destroyed || warmedUp || warmingUp) return;
        warmingUp = true;

        console.log(`[claude-sdk] warming up session ${id}...`);
        const startTime = Date.now();

        const abort = new AbortController();
        activeAbort = abort;

        try {
          const options = buildOptions({ maxTurns: 1, abortController: abort });

          for await (const message of query({ prompt: 'Antworte nur mit: Bereit.', options })) {
            if (message.type === 'system' && message.subtype === 'init' && message.session_id) {
              sessionId = message.session_id;
            }
          }

          warmedUp = true;
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(`[claude-sdk] warm-up fertig in ${elapsed}s`);
        } catch (err) {
          if (abort.signal.aborted) {
            console.log(`[claude-sdk] warm-up abgebrochen`);
            return;
          }
          console.error(`[claude-sdk] warm-up error: ${err.message}`);
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

        console.log(`[claude-sdk] mode=${mode}, session=${sessionId || 'new'}`);
        const startTime = Date.now();

        const abort = new AbortController();
        activeAbort = abort;
        let toolRunning = false;
        let currentToolName = null;
        let hasStreamedText = false;

        try {
          const options = buildOptions({
            model: mode === 'fast' ? 'claude-sonnet-4-6' : 'claude-opus-4-6',
            maxTurns: mode === 'fast' ? 12 : 20,
            abortController: abort,
            resume: sessionId || undefined,
          });

          for await (const message of query({ prompt: content, options })) {
            if (abort.signal.aborted) break;

            if (message.type === 'system' && message.subtype === 'init' && message.session_id) {
              sessionId = message.session_id;
            }

            if (message.type === 'assistant' && message.message?.content) {
              for (const block of message.message.content) {
                if (block.type === 'tool_use' && !toolRunning) {
                  toolRunning = true;
                  currentToolName = block.name?.replace('mcp__otris-docs__', '') || 'unknown';
                  yield { type: 'tool_use', tool: currentToolName, status: 'running' };
                }
                if (block.type === 'text' && block.text) {
                  if (toolRunning) {
                    yield { type: 'tool_use', tool: currentToolName, status: 'done' };
                    toolRunning = false;
                  }
                  hasStreamedText = true;
                  yield { type: 'chunk', content: block.text };
                }
              }
            }

            if (message.type === 'tool') {
              if (toolRunning) {
                yield { type: 'tool_use', tool: currentToolName, status: 'done' };
                toolRunning = false;
              }
            }

            if (message.type === 'result') {
              if (toolRunning) {
                yield { type: 'tool_use', tool: currentToolName, status: 'done' };
                toolRunning = false;
              }
              if (message.subtype === 'success' && message.result && !hasStreamedText) {
                yield { type: 'chunk', content: message.result };
              }
              if (message.subtype === 'error_max_turns') {
                if (message.result && !hasStreamedText) {
                  yield { type: 'chunk', content: message.result };
                } else if (!hasStreamedText) {
                  yield { type: 'error', message: 'Die Anfrage war zu komplex. Bitte versuche eine kürzere Frage.' };
                }
              }
              if (message.subtype === 'error') {
                yield { type: 'error', message: 'Fehler bei der Verarbeitung. Bitte versuche es erneut.' };
              }
            }
          }

          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(`[claude-sdk] fertig in ${elapsed}s`);

          if (!abort.signal.aborted) {
            yield { type: 'done' };
          }
        } catch (err) {
          if (toolRunning) {
            yield { type: 'tool_use', tool: currentToolName, status: 'done' };
          }
          if (abort.signal.aborted) {
            console.log(`[claude-sdk] query abgebrochen`);
            return;
          }
          console.error(`[claude-sdk] error: ${err.message}`);
          yield { type: 'error', message: 'Fehler bei der Verarbeitung. Bitte versuche es erneut.' };
        } finally {
          activeAbort = null;
        }
      },

      async destroy() {
        if (activeAbort) {
          activeAbort.abort();
        }
        destroyed = true;
        sessionId = null;
        warmedUp = false;
        console.log(`[claude-sdk] session ${id} destroyed`);
      }
    };
  }
}
