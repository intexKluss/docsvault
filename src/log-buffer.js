// Ring-Buffer der letzten Server-Log-Zeilen. Faengt console.* ab, damit ein
// Bug-Report die Server-Logs rund um den Fehler mitliefern kann, ohne dass man
// sich erst per docker logs durch die Container wuehlen muss.

const MAX_ENTRIES = 500;
const buffer = [];

function safeStr(v) {
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function record(level, args) {
  const msg = args.map(safeStr).join(' ').slice(0, 2000);
  buffer.push({ ts: new Date().toISOString(), level, msg });
  if (buffer.length > MAX_ENTRIES) buffer.shift();
}

// console.* einmalig umleiten: Ausgabe geht weiter nach stdout/stderr (docker
// logs bleibt unveraendert) UND zusaetzlich in den Ring-Buffer.
export function installLogCapture() {
  if (console.__captured) return;
  const orig = {
    log: console.log.bind(console),
    error: console.error.bind(console),
    warn: console.warn.bind(console),
  };
  console.log = (...a) => { record('log', a); orig.log(...a); };
  console.error = (...a) => { record('error', a); orig.error(...a); };
  console.warn = (...a) => { record('warn', a); orig.warn(...a); };
  console.__captured = true;
}

// Die letzten n Eintraege. Mit sessionId werden die Zeilen auf diese Session
// gefiltert (plus die allgemeinen [server]-Zeilen), sonst kommt alles.
export function recentLogs(n = 150, sessionId = null) {
  const src = sessionId
    ? buffer.filter((e) => e.msg.includes(sessionId) || e.msg.startsWith('[server]'))
    : buffer;
  return src.slice(-n);
}
