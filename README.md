# ROI — Dein Investment-Workspace

Eine deutschsprachige Anwendung zum Planen, Vergleichen und Testen von Investments. Die erste vollständige Version verbindet Portfolioverwaltung, echte historische Marktdaten, Sparplanung, Risikoanalyse, Stresstests und Backtesting in einem Workspace.

## Starten

Voraussetzungen: Node.js ab 22.12 und npm.

```sh
npm ci
npm run dev
```

Danach [http://127.0.0.1:5173](http://127.0.0.1:5173) öffnen. Die Entwicklungsumgebung liefert Oberfläche und Kurs-API auf derselben Adresse aus.

Für den Produktionsstand:

```sh
npm run build
npm start
```

Die gebaute Anwendung läuft auf [http://127.0.0.1:4173](http://127.0.0.1:4173). `PORT` kann den Port ändern. Der lokale Server bindet an die Loopback-Adresse. Der Build erzeugt außerdem ein eigenständiges Worker-ES-Modul unter `dist/server/index.js`; die Konfiguration für Sites liegt in `.openai/hosting.json`.

```sh
npm run check       # TypeScript-Prüfung
npm test            # Numerische Invarianten, Parser, Fehlerfälle und Importprüfung
npm run refresh:data
```

`refresh:data` benötigt Internetzugang und ersetzt den mitgelieferten Kurs-Snapshot nur, wenn alle Instrumente und der EZB-Wechselkurs erfolgreich abgerufen wurden. Der neue Snapshot lässt sich anschließend prüfen und mit Git versionieren; für veröffentlichte Anwendungen ist danach ein neuer Build nötig.

## Funktionen

- **Übersicht:** Portfoliowert in EUR, Buchgewinne, Allokation, historische Modellperformance und Marktentwicklung.
- **Portfolio:** Positionen mit Stückzahl, Einstand und Zielgewicht hinzufügen, bearbeiten und entfernen; Abweichungen zur Zielallokation und rechnerische Rebalancing-Beträge ansehen.
- **Anlageplanung:** Startkapital, Sparrate, Horizont, Ziel, Rendite, Volatilität, Inflation und laufende Kosten variieren; nominale und kaufkraftbereinigte Simulationen vergleichen.
- **Risikoanalyse:** Annualisierte Rendite und Volatilität, Sharpe Ratio, maximaler Drawdown, täglicher Value at Risk und Expected Shortfall auf 95-%-Niveau.
- **Stresstests:** Vorgegebene und eigene hypothetische Schocks für Aktien, Anleihen, Gold, Immobilien und Kryptowährungen, einschließlich Auswirkungen je Position.
- **Backtesting:** Tatsächliche gemeinsame Kurstage, Sparraten, laufende Gebühren und monatliches, jährliches oder kein Rebalancing; SPY als Vergleich.
- **Märkte und Watchlist:** Instrumente suchen, Kursverläufe ansehen und Favoriten speichern.
- **Datensicherung:** Workspace als JSON sichern und wiederherstellen; Positionen als CSV importieren und exportieren.

Das Startportfolio enthält **Beispielbestände und frei gewählte Einstandspreise**. Die Kurse stammen dagegen aus echten Datenabrufen. Ersetze die Beispielbestände durch eigene Positionen, bevor du die Ergebnisse für dein Portfolio verwendest.

## Marktdaten und Herkunft

Der Instrumentenkatalog umfasst VTI, VEA, VWO, BND, GLD, VNQ, SPY, QQQ, AAPL, MSFT, NVDA, TLT, BTC-USD und ETH-USD. Diese begrenzte Auswahl ist ein Datenuniversum für die Analyse, keine Empfehlung zum Kauf; insbesondere bildet sie kein vollständiges europäisches UCITS-Angebot ab.

Primärquelle ist [Yahoo Finance](https://finance.yahoo.com/). Die App lädt Fünfjahresreihen über den Chart-Endpunkt und nutzt bereinigte Tageskurse (`adjclose`), wenn diese vorhanden sind; sonst werden normale Tagesschlusskurse verwendet. Bei einem Ausfall kann für US-Wertpapiere [Stooq](https://stooq.com/) einspringen. Die jeweils tatsächlich verwendete Quelle steht in den Daten. Yahoo und Stooq können unterschiedliche Bereinigungs- und Veröffentlichungskonventionen haben. Tageswerte des laufenden Handelstags können vorläufig sein; es handelt sich nicht um einen garantierten Echtzeitfeed.

Der EUR/USD-Referenzkurs stammt aus der [offiziellen Tagesdatei der Europäischen Zentralbank](https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml). Die Notierung bezeichnet US-Dollar je Euro; USD-Werte werden durch diesen Kurs geteilt.

Der mitgelieferte, tatsächlich heruntergeladene Snapshot in `src/data/market-snapshot.json` wurde am **6. November 2026** abgerufen. Er enthält:

- 1.255 Beobachtungen pro Aktie bzw. ETF vom 8. November 2021 bis 6. November 2026;
- 1.827 Beobachtungen pro Kryptowährung vom 6. November 2021 bis 6. November 2026;
- den EZB-Referenzkurs **1 EUR = 1,1165 USD**, datiert auf den 6. November 2026.

Jede Kursreihe führt Quelle, Quellenlink, ursprünglichen Abrufzeitpunkt, letzten Kurstag und Verfügbarkeitsstatus mit. Die Oberfläche startet sofort mit dem Snapshot und aktualisiert anschließend über die API. Es werden keine Zufallskurse oder erfundenen Ersatzreihen erzeugt.

| Status        | Bedeutung                                                                                                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fresh`       | Erfolgreich vom Anbieter geladen; der Server kann denselben Abruf bis zu 15 Minuten wiederverwenden. Das ist keine Aussage über Echtzeitverfügbarkeit.                          |
| `cached`      | Gesicherte Daten, zum Beispiel der mitgelieferte Snapshot oder der letzte erfolgreiche Abruf nach einem Anbieterfehler. Der ursprüngliche Kurs- und Abrufstand bleibt erhalten. |
| `unavailable` | Keine verwendbaren echten Daten vorhanden. Fehlende Werte werden nicht als Nullkurse ersetzt.                                                                                   |

## API

Alle Endpunkte erlauben ausschließlich `GET` und liegen auf derselben Herkunft wie die Oberfläche.

| Endpunkt                            | Ergebnis                                                                             |
| ----------------------------------- | ------------------------------------------------------------------------------------ |
| `/api/health`                       | Lokaler Dienststatus, Anbieter und Snapshot-Stand; kein externer Abruf.              |
| `/api/instruments`                  | Unterstützter Instrumentenkatalog.                                                   |
| `/api/market`                       | Kursreihen für den gesamten Katalog und EUR/USD.                                     |
| `/api/market?symbols=VTI,BND,SPY`   | Kursreihen für die gewählten Symbole und EUR/USD.                                    |
| `/api/market?symbols=VTI&refresh=1` | Expliziter Aktualisierungsversuch, der den Cache höchstens einmal pro Minute umgeht. |

Die API akzeptiert nur bekannte Symbole, höchstens 16 pro Anfrage und maximal 256 Zeichen für die Symbolabfrage. Gleichzeitige Abrufe desselben Instruments werden zusammengeführt. Externe Anfragen haben ein Zeitlimit von neun Sekunden pro Anbieter; Yahoo-Ausfall plus Stooq-Versuch kann entsprechend länger dauern. Eine vollständige Anfrage benötigt auch bei Ausfall der Primärquelle höchstens 29 externe Abrufe und bleibt damit unter dem üblichen Worker-Limit von 50. Beim Ausfall bleiben datierte echte Sicherungsdaten verfügbar; Fehler werden an den jeweiligen Reihen ausgewiesen.

## Berechnungsmethoden

**Bewertung und Modellhistorie.** Einstandspreise stehen in der Handelswährung des Instruments, aktuell USD; Zielgewichte sind Prozentwerte. Die Übersicht bewertet die heutigen Stückzahlen rückwirkend an gemeinsamen vorhandenen Kurstagen. Sie rekonstruiert keine tatsächlich getätigten Käufe. Kurse werden nicht zwischen fehlenden Tagen aufgefüllt. SPY wird für den Vergleich auf den Anfangswert des Portfolios normiert.

**Währungen.** Bewertungen, historische Modellkurven und Backtests nutzen den aktuell verfügbaren EUR/USD-Referenzkurs konstant über die gesamte Reihe. Historische Währungsgewinne und -verluste sowie die ursprünglichen Wechselkurse beim Kauf sind daher nicht enthalten. Bereinigte historische Preise dienen als Renditeproxy und sind keine damals tatsächlich handelbaren Kaufpreise.

**Risiko.** Einfache tägliche Renditen bilden die Grundlage. Volatilität nutzt die Stichprobenstandardabweichung und `√252`; die annualisierte Rendite wird geometrisch mit 252 Beobachtungen pro Jahr berechnet. Die Sharpe Ratio verwendet die annualisierte arithmetische Tagesrendite abzüglich des frei einstellbaren risikofreien Zinses. Dieser Zins ist eine Annahme und wird nicht als aktueller Marktzins bezogen. VaR ist das empirische 5-%-Quantil der Tagesrenditen als positiver Verlustbetrag; Expected Shortfall/CVaR ist der mittlere Verlust im zugehörigen unteren Rand. Drawdown misst den Rückgang vom bisherigen Höchststand. Bei einem Portfolio ausschließlich aus Kryptowährungen ist die feste 252er-Konvention eine Näherung, weil diese auch am Wochenende handeln.

**Stresstests.** Ein Schock verändert die momentanen Werte einer Anlageklasse unmittelbar um den gewählten Prozentsatz. Historisch benannte Szenarien sind stilisierte Annahmen und keine exakte Wiederholung der damaligen Kurse. Wechselwirkungen, Liquidität und zeitliche Erholung werden nicht modelliert.

**Monte Carlo.** Monatliches geometrisches Renditemodell mit normalverteilten logarithmischen Schocks, konstanten Rendite- und Volatilitätsannahmen sowie festem Zufallsstartwert. Die erwartete Jahresrendite wird über `log(1 + Rendite)` in den monatlichen Drift überführt; die Volatilitätskorrektur beträgt `−½σ²`. Sparraten werden am Monatsende hinzugefügt, laufende Jahreskosten multiplikativ auf die Monate verteilt. Die Darstellung zeigt Median und das 10.–90. Perzentil. Die Zielwahrscheinlichkeit bezieht sich auf das nominale Endziel; die Kaufkraftdarstellung diskontiert mit der gewählten Inflation. Die Simulation modelliert keine Krisenregime oder ausgeprägten Verteilungsränder.

**Backtesting.** Die Zielgewichte werden auf 100 % normiert und auf gemeinsame vorhandene Kurstage angewendet. Bruchstücke sind erlaubt. Sparraten werden beim Wechsel des Kalendermonats zum beobachteten Kurs investiert; Rebalancing findet zum Monats- bzw. Jahreswechsel statt. Laufende Jahreskosten werden über die tatsächliche verstrichene Kalenderzeit anteilig verrechnet (Actual/Actual, einschließlich Wochenenden und Schaltjahren). Die annualisierte Backtest-Rendite nutzt dieselbe Zeitbasis. Rendite und Drawdown basieren auf einer von Einzahlungen bereinigten, zeitgewichteten Wertentwicklung. Der SPY-Vergleich erhält dieselben Einzahlungen, jedoch keine Portfolioverwaltungsgebühr. Steuern, Spreads, Transaktionsgebühren, Handelsbeschränkungen und tatsächliche historische Wechselkurse sind nicht enthalten.

Vergangene Renditen und Simulationen sind keine Prognose und begrenzen mögliche Verluste nicht. ROI unterstützt die eigene Analyse und gibt keine persönlichen Anlageempfehlungen.

## Speicherung und Sicherungen

Positionen, Watchlist, Name und Planungsannahmen werden lokal im Browser unter `roi.workspace.v1` gespeichert. Es gibt keine Anmeldung, geräteübergreifende Synchronisierung, Bankanbindung oder Orderausführung. Die Marktdaten-API erhält Instrumentensymbole, keine Stückzahlen oder Einstandspreise. Andere Browser und das Löschen des lokalen Browserspeichers greifen nicht auf denselben Workspace zu.

Eine **JSON-Sicherung** enthält den vollständigen Workspace einschließlich Watchlist und Planungsannahmen. Ein **CSV-Import** ersetzt die Positionen und behält die übrigen Einstellungen bei. Erstelle vor dem Ersetzen eine Sicherung. Das unterstützte CSV-Format ist:

```csv
symbol,quantity,averageCost,targetWeight
VTI,100,210.50,70
BND,200,72.00,30
```

Dezimalzahlen verwenden einen Punkt. Unterstützte Trenner sind Komma und Semikolon; verschachtelte bzw. zitierte CSV-Felder sind nicht vorgesehen. Die Anwendung validiert Symbole, Zahlenbereiche, doppelte Positionen und das Workspace-Format.

## Aufbau und Erweiterung

- `src/App.tsx`: Workspace, Portfolio, Märkte, Watchlist und Dialoge.
- `src/components/AnalysisPages.tsx`: Anlageplanung, Risiko, Stress und Backtesting.
- `src/lib/analytics.ts`: Reine, unabhängig testbare Rechenfunktionen.
- `src/lib/workspace.ts`: Lokale Speicherung, Validierung und Import/Export.
- `src/data/catalog.ts`: Unterstützte Instrumente und Anlageklassen.
- `server/market.ts`: Anbieterzugriff, Parser, Cache, Zeitlimits und echte Fallbackdaten.
- `scripts/refresh-data.ts`: Reproduzierbare Aktualisierung des versionierten Snapshots.
- `scripts/build-worker.mjs`: Bündelt Oberfläche und API in ein Worker-Modul.
- `tests/`: Numerische Invarianten, Quellenparser und Validierungsfälle.

React, TypeScript und Vite bilden die Oberfläche; die API verwendet standardisierte Web-Requests und Responses und benötigt kein separates Framework. Die Abhängigkeiten sind im `package-lock.json` festgehalten. Zusätzliche Datenanbieter gehören hinter dieselbe API-Grenze; Brokerzugriff, Nutzerkonten, Datenbank und historische FX-Reihen sind mögliche Erweiterungen und aktuell nicht implementiert.
