# Manual Verification for #133 Courses

Dette dokumentet samler de manuelle testcasene som fortsatt trenger menneskelig verifikasjon før `#133` kan lukkes.

Referanser:
- `#133` EPIC: Organisere moduler i kurs
- `#284` deltakerflyt
- `#285` rapportering
- `#286` automatisert dekning
- `#287` status/dokumentasjon

## TC1 Participant course flow

Scope/purpose:
- verifisere at kurs i `/participant` er handlingsbare og at deep-link via `?courseId=` fungerer

Steg:
1. Åpne `/participant` med en bruker som har tilgang til kurs og minst ett publisert kurs.
2. Bekreft at kursseksjonen vises over modulene.
3. Åpne et kurs i accordion-listen.
4. Klikk på en kursmodul som ikke er bestått.
5. Bekreft at modulen lastes inn i samme deltakerflyt som vanlige moduler.
6. Last siden på nytt med `/participant?courseId=<courseId>` for det samme kurset.
7. Bekreft at riktig kurs åpnes automatisk etter lasting.

Forventet resultat:
- kurs vises i `/participant`
- kursmoduler er klikkbare og starter eksisterende modulvalgflyt
- deep-link med `?courseId=` peker til riktig kurs

Automatisere etterpå:
- delvis automatisert allerede, behold manuell kontroll for faktisk UI-opplevelse

## TC2 Course certificate on completed page

Scope/purpose:
- verifisere at kursbevis vises på `/participant/completed` når siste kursmodul er bestått

Steg:
1. Åpne `/participant/completed` som en bruker som har fullført et kurs.
2. Bekreft at seksjonen for kursbevis vises.
3. Bekreft at kursnavn, fullføringsdato og certificate ID vises.
4. Bytt språk til `nb` eller `nn`.
5. Bekreft at kursbevisseksjonen fortsatt rendres med lokaliserte etiketter.

Forventet resultat:
- kursbevisseksjonen vises uten ekstra handlinger
- riktig kurs og certificate ID vises
- etiketter følger valgt locale

Automatisere etterpå:
- i stor grad automatisert i backend/kontrakter, behold manuell sjekk for presentasjon

## TC3 Results course reporting

Scope/purpose:
- verifisere at kursrapport i `/results` følger filtermodellen og oppdaterer tabellen korrekt

Steg:
1. Åpne `/results` med en rolle som har rapporttilgang.
2. Bekreft at kursrapportseksjonen vises.
3. Sett `Course ID` til et kurs som har aktivitet.
4. Last resultater.
5. Bekreft at kursrapporten viser riktig kurs med modul-breakdown.
6. Sett et datointervall som burde gi tomt resultatvindu.
7. Last resultater på nytt.
8. Bekreft at kursrapporten oppdateres til null/tomt vindu for samme kurs.

Forventet resultat:
- `Course ID`-filter påvirker kursrapporten
- dato-filtre påvirker enrolled/completed-tallene
- tabellen oppdateres uten å bryte de andre rapportene

Automatisere etterpå:
- ja, dette er allerede delvis automatisert og bør holdes som integrasjonstest

## TC4 Admin course management

Scope/purpose:
- verifisere at kursfane i Admin Content fungerer fra opprettelse til publisering

Steg:
1. Åpne `/admin-content`.
2. Bytt til `Kurs`-fanen.
3. Opprett et nytt kurs med tittel og beskrivelse.
4. Legg til minst to moduler i kurset og endre rekkefølgen.
5. Lagre kurset.
6. Publiser kurset.
7. Åpne kurset på nytt og bekreft at modulrekkefølgen er bevart.

Forventet resultat:
- kursfane og kursdialog fungerer
- moduler kan legges til og sorteres
- publisering lykkes når kurset har moduler
- lagret rekkefølge vises korrekt ved gjenåpning

Automatisere etterpå:
- ja, dette er nå dekket i API/integrasjon, men UI-flyten trenger manuell sluttsjekk
