# llama.cpp

`llama-server` bringt eine eigene Web Oberfläche mit, die als MCP Client auf docsvault zugreifen kann. Das Modell läuft lokal, die Dokumentation kommt vom Server.

> Die MCP Unterstützung in llama.cpp ist noch jung und verändert sich schnell. Flags und Menünamen können je nach Build leicht abweichen. Mit `llama-server --help` siehst du, was dein Build kann.

## Voraussetzungen

- Ein aktueller `llama-server` Build mit MCP Unterstützung in der Web Oberfläche
- Ein Modell, das **Tool Calling** kann. Das Chat Template muss Tools unterstützen, sonst fällt llama.cpp auf einen generischen Modus zurück und die Aufrufe werden unzuverlässig.
- Der Server muss von deinem Rechner erreichbar sein (im Firmennetz oder per VPN)

## Server starten

```bash
llama-server -m <MODELL>.gguf --port 8080 -c 32768 --jinja --ui-mcp-proxy
```

- `-c 32768` stellt die Context Länge ein. Suchergebnisse und gelesene Seiten landen im Context, mit dem Standardwert läuft er schnell voll.
- `--jinja` aktiviert das Chat Template des Modells für Tool Calling. Bei neueren Builds ist das schon der Standard, bei älteren ist es Pflicht.
- `--ui-mcp-proxy` schaltet den CORS Proxy von llama-server ein (älterer Name: `--webui-mcp-proxy`). Ohne ihn blockiert der Browser die Verbindung zu docsvault, weil der Server eine andere Adresse als die Web Oberfläche hat.

Der Proxy ist experimentell. Lass llama-server mit eingeschaltetem Proxy nur in einem Netz laufen, dem du vertraust.

## Konfiguration in der Web Oberfläche

1. `http://127.0.0.1:8080` im Browser öffnen
2. In den Einstellungen den Bereich für **MCP Server** öffnen
3. Einen neuen Server hinzufügen:
   - **URL:** `http://<SERVER-IP>:3000/mcp`
   - **Transport:** Streamable HTTP
   - **Use llama-server proxy:** einschalten
4. Läuft der Server mit `API_TOKEN`, trägst du den Token als Header `Authorization: Bearer <DEIN-TOKEN>` ein.

Nutze für die Web Oberfläche bei Problemen die IP statt `localhost`, also `http://127.0.0.1:8080`. Ersetz `<SERVER-IP>` durch die IP deines docsvault Servers (z.B. `192.168.2.100`).

## Benutzen

1. Ein neues Gespräch öffnen und den docsvault Server aktivieren
2. Eine Frage zur Dokumentation stellen. Das Modell ruft dann `..._search` und `..._read` auf.

## Hinweise

- `--mcp-servers-config` und `--mcp-servers-json` kennen laut llama-server Dokumentation nur lokale stdio Server (Programme, die llama-server selbst startet). docsvault ist ein Netzwerk Server und gehört deshalb in die Web Oberfläche, nicht in diese Datei.
- Kleine Modelle rufen Tools oft falsch auf oder erfinden Pfade. Pfade für `..._read` kommen immer aus den Suchergebnissen. Hilft nichts, nimm ein größeres Modell oder eines mit besserem Tool Calling.

## Kurz prüfen ob alles läuft

Frag zum Beispiel: "Such in der Dokumentation nach X und fass die erste Seite zusammen." Siehst du einen Tool Aufruf `..._search` mit Ergebnissen, passt alles.

Kommt kein Tool Aufruf, prüfe zuerst, ob das Modell Tool Calling unterstützt. Zeigt die Oberfläche einen Verbindungsfehler, ist meistens der Proxy nicht eingeschaltet oder die URL falsch (`/mcp`, nicht `/sse`).
