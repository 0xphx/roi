# Projektkonventionen

- Der Nutzer verlangt ausdrücklich: Änderungen immer mit Git versionieren, committen und zum konfigurierten GitHub-Remote pushen. Keine fremden Änderungen überschreiben und keine Secrets committen.
- Oberfläche und Dokumentation sind deutschsprachig. Echte Marktdaten, Beispielbestände und Modellannahmen klar unterscheiden; keine erfundenen Kurs-Fallbacks.
- Das Design soll minimalistisch und sachlich bleiben: klare Typografie, wenige Farben, flache Abschnitte. Keine Werbeslogans, dekorativen Verläufe, Promotion-Karten oder erfundenen Profilangaben. Finanzielle Hinweise und gut lesbare Beschriftungen erhalten.
- Portfoliodaten bleiben lokal im Browser. Änderungen an Speicherung, Berechnungen und Datenquellen transparent dokumentieren.
- Rechenlogik in `src/lib/analytics.ts`, Datenzugriff in `server/market.ts`, Oberfläche in `src/` halten. Fachliche Fehler durch aussagekräftige Tests absichern.
- Vor dem Commit relevante Prüfungen ausführen: `npm test`, `npm run build`, `node scripts/smoke-test.mjs`. Bei Oberflächenänderungen zusätzlich im Browser prüfen.
- `src/data/market-snapshot.json` enthält echte abgerufene Kursdaten. Nur über `npm run refresh:data` aktualisieren und Quellen-/Abrufinformationen beibehalten.
- GitHub Pages wird über `.github/workflows/pages.yml` veröffentlicht. Pages ist statisch: keine `/api`-Aufrufe; Projektpfad aus `BASE_URL` beachten. Zusätzlich `npm run build:pages` und `npm run smoke:pages` prüfen.
- Automatische Pages-Kursaktualisierungen schreiben ausschließlich generierte Daten in `.pages-data/` und das Build-Paket. Den neuesten gültigen veröffentlichten Datenstand je Instrument erhalten und ursprüngliche Zeitstempel nie durch Build-Zeitpunkte ersetzen.
