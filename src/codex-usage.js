import { readdir, stat, open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Liest die echte Codex-Account-Burnrate (5h- + Wochen-Fenster) aus den
// Rollout-Logs, die der `codex exec`-Prozess selbst schreibt. Der SDK-Stream
// (exec --experimental-json) liefert nur Token-Counts pro Turn, NICHT die
// rate_limits, drum gibts die Quote nur aus den Rollout-Dateien. Die rate_limits
// sind account-global (über alle Sessions geteilt), also reicht der zuletzt
// geschriebene Rollout für den aktuellen Stand.

// CODEX_HOME wie das Binary auflösen: env oder ~/.codex. In Docker läuft der
// Server als user `node`, HOME=/home/node, also /home/node/.codex.
function codexHome() {
  return process.env.CODEX_HOME || join(homedir(), '.codex');
}

// kleiner cache, damit ein burst (connect + turn + periodischer push) nicht
// jedes mal das filesystem abklappert. force umgeht ihn (z.b. direkt nach einer
// antwort, wenn die quote sich gerade geändert hat).
const TTL_MS = 5000;
let cache = { at: 0, value: null };
let inFlight = null;

// 0..100 clampen und remaining ableiten
function normWindow(w) {
  if (!w || typeof w.used_percent !== 'number') return null;
  const used = Math.max(0, Math.min(100, w.used_percent));
  return {
    usedPercent: Math.round(used * 10) / 10,
    remainingPercent: Math.round((100 - used) * 10) / 10,
    windowMinutes: typeof w.window_minutes === 'number' ? w.window_minutes : null,
    resetsAt: typeof w.resets_at === 'number' ? w.resets_at : null,
  };
}

// alle day-dirs (sessions/YYYY/MM/DD) einsammeln, ohne pro datei zu statten.
// nur readdir auf drei ebenen, das ist auch bei monaten an historie billig.
async function collectDayDirs(base) {
  const dirs = [];
  let years;
  try {
    years = (await readdir(base, { withFileTypes: true })).filter(d => d.isDirectory());
  } catch {
    return dirs;
  }
  for (const y of years) {
    const yp = join(base, y.name);
    let months;
    try { months = (await readdir(yp, { withFileTypes: true })).filter(d => d.isDirectory()); }
    catch { continue; }
    for (const m of months) {
      const mp = join(yp, m.name);
      let days;
      try { days = (await readdir(mp, { withFileTypes: true })).filter(d => d.isDirectory()); }
      catch { continue; }
      for (const d of days) dirs.push(join(mp, d.name));
    }
  }
  return dirs;
}

// die rollout-*.jsonl der neuesten day-dirs nach mtime absteigend sortiert
// liefern. nur die fünf lexikalisch neuesten day-dirs statten (YYYY/MM/DD ist
// nullgepadded -> lexikalisch == chronologisch), das deckt mehrere mitternachts-
// übergänge ab und bleibt billig. begrenzt auf die MAX_CANDIDATES neuesten.
const MAX_CANDIDATES = 10;

async function newestRolloutFiles() {
  const base = join(codexHome(), 'sessions');
  const dayDirs = (await collectDayDirs(base)).sort().slice(-5);
  const files = [];
  for (const dir of dayDirs) {
    let names;
    try { names = await readdir(dir); }
    catch { continue; }
    for (const name of names) {
      if (!name.startsWith('rollout-') || !name.endsWith('.jsonl')) continue;
      const p = join(dir, name);
      try {
        const s = await stat(p);
        files.push({ path: p, mtimeMs: s.mtimeMs });
      } catch { /* datei evtl. gerade weggeräumt, ignorieren */ }
    }
  }
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files.slice(0, MAX_CANDIDATES).map(f => f.path);
}

// die rollout-datei von hinten lesen und die letzte zeile mit rate_limits parsen.
// die files können bei langen sessions groß werden, drum nur das letzte stück
// laden; die quote wird nach jedem turn geschrieben, steht also nah am ende.
async function lastRateLimits(path) {
  const fh = await open(path, 'r');
  try {
    const { size } = await fh.stat();
    const len = Math.min(size, 2 * 1024 * 1024);
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, size - len);
    const lines = buf.toString('utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line.includes('"rate_limits"')) continue;
      let obj;
      try { obj = JSON.parse(line); }
      catch { continue; } // evtl. am chunk-rand abgeschnitten, nächste zeile
      const rl = (obj && obj.payload && obj.payload.rate_limits) || (obj && obj.rate_limits);
      if (rl && (rl.primary || rl.secondary)) return rl;
    }
    return null;
  } finally {
    await fh.close();
  }
}

async function compute() {
  // neueste zuerst, aber durchprobieren: ein frischer rollout einer parallelen
  // session (warm-up noch nicht durch) hat noch keine rate_limits -> dann die
  // nächstältere datei nehmen, die quote ist account-global also überall gleich.
  const paths = await newestRolloutFiles();
  let rl = null;
  for (const p of paths) {
    try { rl = await lastRateLimits(p); }
    catch { continue; }
    if (rl) break;
  }
  if (!rl) return null;

  const primary = normWindow(rl.primary);     // 5h-Fenster (window_minutes 300)
  const secondary = normWindow(rl.secondary); // Wochen-Fenster (window_minutes 10080)
  const windows = [primary, secondary].filter(Boolean);
  if (windows.length === 0) return null;

  // bindendes fenster = das mit dem wenigsten rest, daran läuft man zuerst auf.
  const binding = windows.reduce((a, b) => (a.remainingPercent <= b.remainingPercent ? a : b));

  return {
    primary,
    secondary,
    binding,
    planType: typeof rl.plan_type === 'string' ? rl.plan_type : null,
    capturedAt: Date.now(),
  };
}

// Liefert die aktuelle Burnrate oder null, wenn keine Rollouts da sind (z.b.
// Claude-Bridge oder noch kein Turn gelaufen). Wirft nie, fehlende Daten sind
// kein Fehler - das Frontend blendet den Balken dann einfach aus.
export async function readBurnRate({ force = false } = {}) {
  const now = Date.now();
  if (!force && cache.value !== null && now - cache.at < TTL_MS) return cache.value;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const value = await compute();
      cache = { at: Date.now(), value };
      return value;
    } catch (err) {
      console.error(`[codex-usage] burn-rate read error: ${err.message}`);
      return cache.value; // letzten bekannten stand behalten statt flackern
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
