# Roadmap

Stand: 11. November 2026. Die Reihenfolge priorisiert nachvollziehbare Berechnungen und den praktischen Nutzen der lokalen GitHub-Pages-Anwendung.

## Grundlage — umgesetzt in 1.0

- Portfolioverwaltung mit echten, datierten Tageskursen und EZB-Referenzkurs.
- Spar- und Zielplanung mit reproduzierbarer Monte-Carlo-Simulation.
- Historische Risikoanalyse, hypothetische Stresstests und Backtesting.
- Lokale Speicherung, JSON-/CSV-Sicherungen und automatische Veröffentlichung auf GitHub Pages.
- Minimalistische deutschsprachige Oberfläche.

## Portfolios und Strategien — umgesetzt in 1.1

- Bis zu zwölf getrennt gespeicherte Portfolios mit eigenem Bestand, Zielgewichten, Watchlist und Anlageplan.
- Leere Portfolios erstellen, bestehende duplizieren, umbenennen, wechseln und entfernen.
- Bestehende Einzelportfolio-Daten im Browser übernehmen; alte Sicherungen weiterhin importieren.
- Gesamtsicherungen exportieren und nach Prüfung importieren.
- Bis zu vier Strategien mit identischen Einzahlungen, Kosten, Rebalancing und gemeinsamen Kurstagen vergleichen.
- Neues Kapital rechnerisch auf untergewichtete Positionen verteilen, ohne Verkäufe; Verteilung als CSV ausgeben.

## Historische Währungsumrechnung — umgesetzt in 1.2

- Historische EUR/USD-Reihen der EZB mit Quellen- und ursprünglichen Abrufinformationen.
- EUR-Modellhistorie, Risikokennzahlen, Korrelationen, Backtests und Strategievergleiche mit tagesgenauen Referenzkursen, einschließlich SPY.
- Vergleich des heutigen Bestands mit festem Start-Wechselkurs auf denselben Tagen; Renditedifferenz in Prozentpunkten und ausgelassene Tage sichtbar.
- Keine Auffüllung fehlender Referenzkurse und getrennte Ausfallsicherung im Serverbetrieb sowie auf GitHub Pages.

Abnahme: reproduzierbare Umrechnung an tatsächlichen Kurstagen, geprüfte Ausfallpfade und keine erfundenen Ersatzkurse. Bestände, Pläne und Sicherungsformate bleiben unverändert.

## Instrumentenuniversum — nächster Schritt

- Das Angebot gezielt um europäische ETFs erweitern, sobald zuverlässige Kurs- und Identifikationsdaten vorhanden sind.
- Handelswährung, Börsenplatz und Fondsvariante eindeutig zuordnen; Kurslücken sowie Ausschüttungs- und Bereinigungskonventionen offenlegen.
- Referenzdaten und unterschiedliche Währungsfälle durch Tests absichern. Das heutige Angebot bleibt ein begrenztes Analyseuniversum.

## Tatsächlicher Depotverlauf — danach

- Ein lokales Journal für Käufe, Verkäufe, Einzahlungen, Entnahmen, Ausschüttungen und Gebühren.
- Anfangsbestände ausdrücklich von nachweisbaren Transaktionen unterscheiden; keine fiktiven Kaufdaten erzeugen.
- Geld- und zeitgewichtete Renditen auf Basis des Journals sowie verständliche Abweichungen zur Modellrechnung.
- Transaktionsdateien vor dem Import prüfen, Zuordnungen anzeigen und doppelte Buchungen erkennen.

Abnahme: Geldflüsse, Stückzahlen und Einstand stimmen mit dem importierten Journal überein; bestehende Bestandsportfolios bleiben nutzbar.

## Optionale Integrationen — später

- Zunächst lesender Depotimport über konkret ausgewählte Anbieter.
- Nutzerkonten, Datenbank und geräteübergreifende Synchronisierung nur nach einer ausdrücklichen Entscheidung für Cloud-Speicherung und Zugangsschutz.
- Orderausführung ist kein Bestandteil der aktuellen Planung.

Die nächsten Etappen sind geplant, aber noch nicht implementiert. Aktuelle Grenzen der Berechnungen sind in der README und in den Methodik-Hinweisen der Anwendung beschrieben.
