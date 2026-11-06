# Änderungen

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
