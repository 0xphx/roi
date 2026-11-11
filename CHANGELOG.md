# Änderungen

## 1.2.0 — 2026-11-11

- Historische EUR/USD-Referenzkurse der EZB mit Quelle, Kursdatum und ursprünglichem Abrufzeitpunkt.
- Tagesgenaue EUR-Umrechnung in Modellhistorie, Risikoanalyse, Korrelationen, Backtest und Strategievergleich einschließlich SPY.
- Währungseinfluss als Vergleich mit festem Start-Wechselkurs auf identischen Kurstagen; Differenz in Prozentpunkten und ausgelassene Tage sichtbar.
- Keine Auffüllung fehlender Referenzkurse. Alte Daten ohne Historie bleiben lesbar, historische USD-Auswertungen zeigen dann einen Hinweis.
- Getrennte Ausfallsicherung für aktuelle und historische Wechselkurse im Serverbetrieb und in der statischen Pages-Pipeline.
- Echten Kursdaten-Snapshot über `npm run refresh:data` aktualisiert: 14 Instrumente und 1.289 historische EZB-Referenzkurse.
- Portfolio-Speicherung und Sicherungsformate bleiben unverändert. Einstand und hypothetische Sofortbewertungen verwenden weiterhin den aktuellen Referenzkurs; tatsächliche historische Käufe werden nicht rekonstruiert.

## 1.1.1 — 2026-11-10

- Portfoliowert stärker gewichtet und Zahlen in Bestands- und Rebalancing-Tabellen rechtsbündig ausgerichtet.
- Navigation kompakter, mobile Menüeinträge leichter bedienbar und Bearbeiten-Aktion eindeutig gekennzeichnet.
- Beschriftungen und Hinweise sprachlich überarbeitet; Gestaltungsgrundsätze für weitere Änderungen festgehalten.
- Berechnungen, Datenquellen und lokale Speicherung unverändert.

## 1.1.0 — 2026-11-09

- Lokale Sammlung mit bis zu zwölf Portfolios, getrennten Plänen und Watchlists.
- Portfolios erstellen, duplizieren, umbenennen, wechseln und entfernen.
- Nicht schreibende Migration vorhandener Einzelbestände und Gesamtsicherungen mit Importprüfung.
- Vergleich von bis zu vier Zielstrategien über identische Kurstage und Annahmen.
- Rebalancing aus zusätzlichem Kapital ohne Verkäufe, einschließlich CSV-Ausgabe.
- Getestete Datenvalidierung, Budgeterhaltung und Vergleichbarkeit; veröffentlichte Roadmap für weitere Daten- und Journalfunktionen.

## 1.0.2 — 2026-11-07

- Minimalistische Oberfläche mit neutralen Farben, klarer Typografie und flachen Abschnitten.
- Werbetexte, dekorative Badges, Profilattrappe und doppelte Marktübersicht entfernt.
- Allokation als schlichte Übersicht statt Donut; Diagramme ohne Verläufe und Animationen.
- Beschriftungen vereinheitlicht, Textkontrast verbessert und mobile Navigation für Tastaturbedienung korrigiert.

## 1.0.1 — 2026-11-06

- Veröffentlichung auf GitHub Pages über einen geprüften Actions-Workflow.
- Statische Kursdaten unter dem Repository-Pfad statt nicht verfügbarer Server-API.
- Täglicher Aktualisierungsversuch mit Erhalt des neuesten gültigen veröffentlichten Datenstands je Instrument.
- Favicon und Styles funktionieren unter `/roi/`; Quellen- und Aktualisierungshinweise unterscheiden Pages- und Serverbetrieb.
- Zusätzliche Prüfungen für Unterverzeichnisse, Datenvalidierung und Ausfallverhalten.

## 1.0.0 — 2026-11-06

Erste nutzbare Version des Investment-Workspace:

- Portfolioverwaltung, Zielallokation und Rebalancing-Berechnung.
- Echte Fünfjahresdaten für 14 Instrumente, EZB-Referenzkurs, Datenstatus und datierter Offline-Fallback.
- Spar- und Zielplanung mit reproduzierbarer Monte-Carlo-Simulation und Kaufkraftansicht.
- Historische Risikoanalyse, täglicher VaR/Expected Shortfall, Drawdown und Korrelationen.
- Anpassbare hypothetische Stresstests und Backtests mit Sparraten, Gebühren und Rebalancing.
- Suche, Watchlist, lokale Speicherung sowie JSON- und CSV-Sicherungen.
- Responsive deutsche Oberfläche, automatisierte Berechnungs-/API-Prüfungen und GitHub-CI.

Umfang: persönliches Analysewerkzeug mit lokal gespeicherten Daten. Kein Depotanschluss, keine Orderausführung, keine Cloud-Synchronisierung. Historische EUR-Analysen verwenden einen konstanten aktuellen Referenzkurs; Steuern und Transaktionskosten sind nicht modelliert.
