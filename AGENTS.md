# Projektkonventionen

- Der Nutzer verlangt ausdrücklich: Änderungen immer mit Git versionieren, committen und zum konfigurierten GitHub-Remote pushen. Keine fremden Änderungen überschreiben und keine Secrets committen.
- Oberfläche und Dokumentation sind deutschsprachig. Echte Marktdaten, Beispielbestände und Modellannahmen klar unterscheiden; keine erfundenen Kurs-Fallbacks.
- Portfoliodaten bleiben lokal im Browser. Änderungen an Speicherung, Berechnungen und Datenquellen transparent dokumentieren.
- Rechenlogik in `src/lib/analytics.ts`, Datenzugriff in `server/market.ts`, Oberfläche in `src/` halten. Fachliche Fehler durch aussagekräftige Tests absichern.
- Vor dem Commit relevante Prüfungen ausführen: `npm test`, `npm run build`, `node scripts/smoke-test.mjs`. Bei Oberflächenänderungen zusätzlich im Browser prüfen.
- `src/data/market-snapshot.json` enthält echte abgerufene Kursdaten. Nur über `npm run refresh:data` aktualisieren und Quellen-/Abrufinformationen beibehalten.
