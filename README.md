# ROI — Portfolioanalyse und Anlageplanung

Eine deutschsprachige Anwendung für Portfolios, Sparpläne und Risikoanalysen. Mit historischen Marktdaten lassen sich Strategien vergleichen und Annahmen prüfen. Bestände und Pläne bleiben lokal im Browser.

## Gestaltung

ROI verwendet eine zurückhaltende Oberfläche mit klarer Gewichtung der Informationen. Der Portfoliowert steht im Vordergrund; weitere Kennzahlen und Tabellen lassen sich direkt vergleichen. Farbe kennzeichnet überwiegend Gewinne und Verluste. Beschriftungen benennen die jeweilige Handlung, Hinweise erklären Datenstand und Modellgrenzen. Diese Grundsätze gelten auch für weitere Funktionen; sie sind in `AGENTS.md` festgehalten.

## GitHub Pages

Die Online-Version liegt unter [https://0xphx.github.io/roi/](https://0xphx.github.io/roi/). Bei Änderungen an `main` baut und veröffentlicht der Workflow `.github/workflows/pages.yml` die geprüfte statische Anwendung. Der Repository-Pfad `/roi/` wird für JavaScript, CSS, Favicon und Kursdatei berücksichtigt; die Navigation verwendet Hash-Links und funktioniert auch nach einem Neuladen.

GitHub Pages stellt keinen eigenen API-Server bereit. Die Online-Version lädt deshalb `market-data.json` aus derselben Veröffentlichung. Ein täglicher GitHub-Actions-Lauf um **22:23 UTC** versucht neue echte Kursreihen und den EZB-Referenzkurs abzurufen. Erfolgreiche Abrufe werden je Instrument übernommen; bei Ausfällen bleiben die zuletzt veröffentlichten gültigen Reihen erhalten. Kurs- und Abrufdatum werden nicht auf den Veröffentlichungszeitpunkt umgeschrieben. „Daten neu laden“ lädt den aktuell veröffentlichten Stand und löst keinen unmittelbaren Anbieterabruf aus.

Zeitgesteuerte Actions können verspätet starten; GitHub kann sie in öffentlichen Repositories nach längerer Inaktivität deaktivieren. Unter **Actions → GitHub Pages veröffentlichen → Run workflow** lässt sich die Aktualisierung auch manuell starten. Datenstand und Quelle bleiben in der App sichtbar. Positionen und Pläne verbleiben im Browser und werden nicht in die öffentliche Kursdatei geschrieben. Beim Wechsel von der lokalen zur Online-Adresse kannst du sie per JSON-Export und -Import übernehmen.

Den reinen Pages-Build lokal prüfen:

```sh
npm run build:pages
npm run smoke:pages
npm run preview:pages
```

Die Vorschau läuft unter [http://127.0.0.1:4174/roi/](http://127.0.0.1:4174/roi/). Optional erzeugt `npm run refresh:pages` neue Daten in `.pages-data/market-data.json`; `PAGES_SITE_URL` setzt die vorher veröffentlichte Basisadresse für den Ausfallschutz. Ohne diese Datei verwendet der Build den echten versionierten Snapshot. `PAGES_BASE_PATH` überschreibt bei Bedarf `/roi/`, beispielsweise mit `/` für eine eigene Domain. Der Workflow übernimmt den Pfad aus der Pages-Konfiguration.

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

Der Ausbau und die nächsten Schritte stehen in der [Roadmap](ROADMAP.md). Version 1.1 ergänzt die lokale Portfolio-Sammlung, einen vergleichbaren Strategietest und Rebalancing mit neuen Einzahlungen.

- **Übersicht:** Portfoliowert in EUR, Buchgewinne, Allokation, historische Modellperformance und Marktentwicklung.
- **Portfolio-Sammlung:** Bis zu zwölf Portfolios getrennt verwalten, erstellen, duplizieren, umbenennen und wechseln. Jedes hat eigene Positionen, Zielgewichte, Watchlist, Plan und Sharpe-Zinsannahme.
- **Portfolio:** Positionen mit Stückzahl, Einstand und Zielgewicht hinzufügen, bearbeiten und entfernen; Abweichungen zur Zielallokation und rechnerische Rebalancing-Beträge ansehen.
- **Rebalancing mit Einzahlungen:** Zusätzliches Kapital proportional zu den fehlenden Zielbeträgen verteilen, ohne Positionen zu verkaufen; rechnerische Zukäufe und Stückzahlen als CSV exportieren.
- **Anlageplanung:** Startkapital, Sparrate, Horizont, Ziel, Rendite, Volatilität, Inflation und laufende Kosten variieren; nominale und kaufkraftbereinigte Simulationen vergleichen.
- **Risikoanalyse:** Annualisierte Rendite und Volatilität, Sharpe Ratio, maximaler Drawdown, täglicher Value at Risk und Expected Shortfall auf 95-%-Niveau.
- **Stresstests:** Vorgegebene und eigene hypothetische Schocks für Aktien, Anleihen, Gold, Immobilien und Kryptowährungen, einschließlich Auswirkungen je Position.
- **Backtesting:** Tatsächliche gemeinsame Kurstage, Sparraten, laufende Gebühren und monatliches, jährliches oder kein Rebalancing; SPY als Vergleich.
- **Strategievergleich:** Bis zu vier gespeicherte Portfolios mit denselben Einzahlungen, Zusatzkosten, Rebalancing und gemeinsamen tatsächlichen Kurstagen vergleichen. Angezeigt werden Endvermögen, zeitgewichtete Rendite, CAGR, Drawdown und Kosten.
- **Märkte und Watchlist:** Instrumente suchen, Kursverläufe ansehen und Favoriten speichern.
- **Datensicherung:** Einzelportfolios und Gesamtsicherungen als JSON sichern und wiederherstellen; Positionen und Rebalancing-Verteilungen als CSV exportieren, Positionen als CSV importieren.

Das Startportfolio enthält **Beispielbestände und frei gewählte Einstandspreise**. Die Kurse stammen dagegen aus echten Datenabrufen. Ersetze die Beispielbestände durch eigene Positionen, bevor du die Ergebnisse für dein Portfolio verwendest.

## Marktdaten und Herkunft

Der Instrumentenkatalog umfasst VTI, VEA, VWO, BND, GLD, VNQ, SPY, QQQ, AAPL, MSFT, NVDA, TLT, BTC-USD und ETH-USD. Diese begrenzte Auswahl ist ein Datenuniversum für die Analyse, keine Empfehlung zum Kauf; insbesondere bildet sie kein vollständiges europäisches UCITS-Angebot ab.

Primärquelle ist [Yahoo Finance](https://finance.yahoo.com/). Die App lädt Fünfjahresreihen über den Chart-Endpunkt und nutzt bereinigte Tageskurse (`adjclose`), wenn diese vorhanden sind; sonst werden normale Tagesschlusskurse verwendet. Bei einem Ausfall kann für US-Wertpapiere [Stooq](https://stooq.com/) einspringen. Die jeweils tatsächlich verwendete Quelle steht in den Daten. Yahoo und Stooq können unterschiedliche Bereinigungs- und Veröffentlichungskonventionen haben. Tageswerte des laufenden Handelstags können vorläufig sein; es handelt sich nicht um einen garantierten Echtzeitfeed.

Der EUR/USD-Referenzkurs stammt aus der [offiziellen Tagesdatei der Europäischen Zentralbank](https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml). Die Notierung bezeichnet US-Dollar je Euro; USD-Werte werden durch diesen Kurs geteilt.

Der mitgelieferte, tatsächlich heruntergeladene Snapshot in `src/data/market-snapshot.json` wurde am **6. November 2026** abgerufen. Er enthält:

- 1.255 Beobachtungen pro Aktie bzw. ETF vom 8. November 2021 bis 6. November 2026;
- 1.827 Beobachtungen pro Kryptowährung vom 6. November 2021 bis 6. November 2026;
- den EZB-Referenzkurs **1 EUR = 1,1165 USD**, datiert auf den 6. November 2026.

Jede Kursreihe führt Quelle, Quellenlink, ursprünglichen Abrufzeitpunkt, letzten Kurstag und Verfügbarkeitsstatus mit. Die Oberfläche startet sofort mit dem Snapshot und lädt anschließend den veröffentlichten Pages-Datenstand beziehungsweise im Serverbetrieb die API. Es werden keine Zufallskurse oder erfundenen Ersatzreihen erzeugt. Statisch veröffentlichte Daten tragen immer den Status `cached`, auch wenn der Aktualisierungslauf sie gerade erst vom Anbieter abgerufen hat.

| Status        | Bedeutung                                                                                                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fresh`       | Erfolgreich vom Anbieter geladen; der Server kann denselben Abruf bis zu 15 Minuten wiederverwenden. Das ist keine Aussage über Echtzeitverfügbarkeit.                          |
| `cached`      | Gesicherte Daten, zum Beispiel der mitgelieferte Snapshot oder der letzte erfolgreiche Abruf nach einem Anbieterfehler. Der ursprüngliche Kurs- und Abrufstand bleibt erhalten. |
| `unavailable` | Keine verwendbaren echten Daten vorhanden. Fehlende Werte werden nicht als Nullkurse ersetzt.                                                                                   |

## API

Diese Endpunkte gelten für den lokalen Entwicklungsserver und den Worker-Betrieb. GitHub Pages verwendet ausschließlich die statische Datei `market-data.json` unter dem Projektpfad und ruft keine `/api`-Endpunkte auf. Alle Server-Endpunkte erlauben ausschließlich `GET` und liegen auf derselben Herkunft wie die Oberfläche.

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

**Strategievergleich.** Die positive Zielgewichtung jeder ausgewählten Strategie wird normiert und mit identischen Annahmen durch denselben Backtest gerechnet. Der Datenbestand wird zuvor auf die Schnittmenge der Kurstage aller benötigten Instrumente begrenzt; verfügbare SPY-Kurse werden in dieselbe Schnittmenge einbezogen. Fehlende Positionen oder zu wenige gemeinsame Kurstage werden als Fehler angezeigt. Die zeitgewichtete Rendite zählt zusätzliche Einzahlungen nicht als Gewinn. Der aktuelle EUR/USD-Kurs bleibt konstant; historische Währungseffekte fehlen weiterhin.

**Rebalancing mit neuem Kapital.** Für jede Position wird das Zielvermögen nach Einzahlung abzüglich des aktuellen Marktwerts berechnet. Nur positive Fehlbeträge erhalten Kapital, proportional zu ihrem Fehlbetrag. Die gesamte Eingabe wird verteilt; negative Zukäufe oder Verkäufe entstehen nicht. Bruchstücke sind erlaubt, es werden keine Orders erstellt. Die Verteilung berücksichtigt weder Handelskosten noch Steuern und kann bei stark übergewichteten Positionen die Zielgewichte nicht vollständig herstellen.

## Speicherung und Sicherungen

Die aktive Portfolio-Sammlung wird lokal unter `roi.portfolio-library.v1` gespeichert. Beim ersten Laden übernimmt Version 1.1 einen bestehenden `roi.workspace.v1`-Einzelbestand im Speicher; der alte Eintrag wird dabei nicht verändert. Erst bei einer bewussten Änderung wird die Sammlung als ein validierter JSON-Wert gespeichert. Ein fehlgeschlagener Schreibzugriff aktualisiert die geöffnete Sammlung nicht. Änderungen aus anderen Fenstern desselben Browsers werden synchronisiert.

Bis zu zwölf Portfolios enthalten jeweils ein eigenständiges Workspace-Objekt im bisherigen Version-1-Format. Eine **Einzelportfolio-Sicherung** enthält nur das aktive Portfolio. Eine **Gesamtsicherung** ist mit `kind: "roi-portfolio-library"` gekennzeichnet und enthält alle Portfolios plus die aktive ID. Vor dem Ersetzen einer gesamten Sammlung zeigt die Anwendung eine Importprüfung mit Anzahl und aktivem Portfolio; eine aktuelle Sicherung kann vorher heruntergeladen werden. Alte Workspace-JSON-Dateien bleiben verwendbar und ersetzen ausschließlich das aktive Portfolio. Ein **CSV-Import** ersetzt dessen Positionen und behält die übrigen Einstellungen sowie andere Portfolios bei.

Es gibt keine Anmeldung, geräteübergreifende Synchronisierung, Bankanbindung oder Orderausführung. Die öffentliche Pages-Kursdatei enthält ausschließlich Marktdaten. Stückzahlen, Einstandspreise und Planungsannahmen werden nicht veröffentlicht. Andere Browser, Geräte und das Löschen des lokalen Speichers greifen nicht auf dieselbe Sammlung zu. Erstelle vor dem Ersetzen oder Löschen eine Sicherung.

Das unterstützte CSV-Format ist:

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
- `src/lib/workspace.ts`: Bestehendes Einzelportfolio-Format, Validierung und CSV-Import/Export.
- `src/lib/portfolio-library.ts`: Portfolio-Sammlung, nicht schreibende Migration, atomare Speicherung und Verwaltung.
- `src/components/ComparePage.tsx`: Strategievergleich mit gemeinsamen Annahmen und Datenzeiträumen.
- `src/components/PortfolioManager.tsx` und `CashRebalance.tsx`: Portfolioverwaltung und rechnerische Zukäufe aus neuem Kapital.
- `src/lib/market-client.ts`: Geprüfte Marktdatenantworten und getrennte Abrufwege für Pages und API.
- `src/data/catalog.ts`: Unterstützte Instrumente und Anlageklassen.
- `server/market.ts`: Anbieterzugriff, Parser, Cache, Zeitlimits und echte Fallbackdaten.
- `scripts/refresh-data.ts`: Reproduzierbare Aktualisierung des versionierten Snapshots.
- `scripts/refresh-pages-data.ts`: Teilweise Aktualisierung mit Erhalt neuerer veröffentlichter Daten bei Anbieterausfällen.
- `scripts/build-pages.mjs` und `scripts/smoke-pages.mjs`: Statisches Veröffentlichungspaket und Prüfung aller Projektpfade und Daten.
- `scripts/build-worker.mjs`: Bündelt Oberfläche und API in ein Worker-Modul.
- `tests/`: Numerische Invarianten, Quellenparser und Validierungsfälle.

React, TypeScript und Vite bilden die Oberfläche; die API verwendet standardisierte Web-Requests und Responses und benötigt kein separates Framework. Die Abhängigkeiten sind im `package-lock.json` festgehalten. Zusätzliche Datenanbieter gehören hinter dieselbe API-Grenze; Brokerzugriff, Nutzerkonten, Datenbank und historische FX-Reihen sind mögliche Erweiterungen und aktuell nicht implementiert.
