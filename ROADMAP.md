# Roadmap

Stand: 9. November 2026. Die Reihenfolge priorisiert nachvollziehbare Berechnungen und den praktischen Nutzen der lokalen GitHub-Pages-Anwendung.

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

## Daten und Währungsrisiko — nächster Schritt

- Historische EUR/USD-Reihen mit Quellen- und Abrufinformationen einbinden.
- Historische EUR-Renditen mit tatsächlichen Wechselkursen statt des derzeit konstanten Referenzkurses berechnen.
- Auswirkungen der Währungsumrechnung getrennt ausweisen und Datenlücken ausdrücklich markieren.
- Das Instrumentenuniversum gezielt um europäische ETFs erweitern, sobald zuverlässige Kurs- und Identifikationsdaten vorhanden sind.

Abnahme: reproduzierbare Umrechnung an tatsächlichen Kurstagen, geprüfte Ausfallpfade und keine erfundenen Ersatzkurse.

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
