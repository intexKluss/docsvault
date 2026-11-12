# LM Studio

LM Studio kann als MCP Client auf docsvault zugreifen. Das Modell läuft komplett lokal auf deinem Rechner, nur die Dokumentation kommt vom Server.

## Voraussetzungen

- Eine aktuelle LM Studio Version (MCP gibt es ab 0.3.17)
- Ein Modell, das **Tool Calling** kann. In der Modellliste erkennst du das am Hammer Symbol. Modelle ohne Tool Calling sehen die docsvault Tools nicht.
- Der Server muss von deinem Rechner erreichbar sein (im Firmennetz oder per VPN)

## Konfiguration

1. In LM Studio rechts den Tab **Program** öffnen
2. Bei **Install** auf **Edit mcp.json** klicken
3. Den Server eintragen und speichern:

```json
{
  "mcpServers": {
    "docsvault": {
      "url": "http://<SERVER-IP>:3000/mcp"
    }
  }
}
```

LM Studio lädt die Datei beim Speichern automatisch neu. Ersetz `<SERVER-IP>` durch die IP deines Servers (z.B. `192.168.2.100`).

### Mit Token

Läuft der Server mit `API_TOKEN`, schickst du den Token als Header mit:

```json
{
  "mcpServers": {
    "docsvault": {
      "url": "http://<SERVER-IP>:3000/mcp",
      "headers": {
        "Authorization": "Bearer <DEIN-TOKEN>"
      }
    }
  }
}
```

## Benutzen

1. Ein Modell mit Tool Calling laden
2. Im Chat die docsvault Tools aktivieren (der Server taucht in der Tool Auswahl auf)
3. Eine Frage zur Dokumentation stellen. Das Modell ruft dann `..._search` und `..._read` auf.

Bei jedem Tool Aufruf fragt LM Studio nach. Du siehst die Argumente und kannst den Aufruf einmal erlauben oder dauerhaft freigeben. Die dauerhaften Freigaben ändern sich unter **App Settings > Tools & Integrations**.

## Tipps für lokale Modelle

- **Context Länge hochstellen.** Suchergebnisse und gelesene Seiten landen im Context. Mit dem Standardwert läuft er schnell voll. 16k sind das Minimum, besser 32k oder mehr, solange der VRAM es hergibt.
- **Größere Modelle machen weniger Fehler.** Kleine Modelle rufen Tools oft falsch auf oder erfinden Pfade. Wenn die Tools nicht sauber genutzt werden, hilft meistens ein größeres Modell oder ein anderes Modell mit besserem Tool Calling.
- **Erst suchen, dann lesen.** Pfade für `..._read` kommen aus den Suchergebnissen. Rät ein Modell sie, kommt ein Fehler zurück.

## Kurz prüfen ob alles läuft

Frag im Chat zum Beispiel: "Such in der Dokumentation nach X und fass die erste Seite zusammen." Siehst du einen Tool Aufruf `..._search` mit Ergebnissen, passt alles.

Kommt kein Tool Aufruf, prüfe zuerst, ob das Modell Tool Calling unterstützt, und dann, ob der Server im Browser unter `http://<SERVER-IP>:3000/api/vaults` antwortet.
