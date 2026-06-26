# Kohort-/gruppemodell for kurstildeling (#645, #496 / Tier 2, EPIC #478) — designnotat

> Status: **retning besluttet** (2026-06-25). Erstatter premisset i #645 («populer
> `User.department` fra Entra») fordi organisasjonen ikke har avdelinger, men **overlappende
> grupper** (mange-til-mange). Påvirker EN-2 (#641) sin `DEPARTMENT`-gren og EN-3 (#642) tildelings-UI.
>
> **Beslutninger (eier, 2026-06-25):**
> 1. **C — hybrid** (`Class.kind: MANUAL | ENTRA`), men **bygg manuelle klasser (B) først**. Entra-kobling
>    skal være **konfigurerbar av Administrator** (kan slås av/på via plattform-config) — når av finnes kun
>    manuelle klasser.
> 2. **Dynamisk** tildeling (medlemskap evalueres ved lesetid; ingen snapshot).
> 3. **Slett `User.department`** helt (unngå bloat) — kolonne + kode + orgSync-bruk fjernes.
> 4. **Egen systemklasse «Alle deltakere»** med eksplisitt populasjon (PARTICIPANT-rolle).
> 5. **Administrator** kuraterer hvilke Entra-grupper som er tildelbare — **OK å utsette** fra v1.

## 1. Problem / mål
EN-2 (#641) lar admin tildele kurs **individuelt** (per bruker) eller per **avdeling** — der avdeling
er en enkelt streng (`User.department`) som matches eksakt. Eieren har påpekt at virkeligheten ikke er
avdelinger, men **overlappende grupper** (en person er i flere samtidig). En enkelt-streng kan ikke
modellere et mange-til-mange-forhold. Vi trenger en **kohort**-mekanisme: «tildel dette kurset til alle
i gruppe/klasse X», der en bruker kan tilhøre mange kohorter.

Individuell tildeling og selv-påmelding (EN-2) er uberørt av dette notatet; de fungerer som de skal.

## 2. Funn fra prod Active Directory (Entra `a018856e`, lest 2026-06-25)
Read-only directory-utforskning av prod-tenanten:

- **246 brukere, 198 grupper.**
- Typer: **163 M365 (Unified)**, 25 Security, 10 Distribusjon.
- Gruppene representerer **prosjekter, faggrupper og kunde-engasjementer** — f.eks. «A-2 KI strategi»,
  «Co-pilot evaluering», «A-2 Prosjektgjennomføring faggruppe», «ACMP-kurs», «Deichman –
  lokalbibliotekene». Dette er nettopp de overlappende enhetene.
- **Overlapp-grad** (grupper per bruker, utvalg): 1, 2, 5, 18, 23, **35**. Ansatte er i mange grupper
  samtidig → mange-til-mange bekreftet utvetydig.
- Gruppestørrelser (utvalg): «Alle i A-2 Norge» = 61, faggruppe = 15, «Co-pilot evaluering» = 10,
  «KI strategi» = 9.
- **«Alle i A-2 Norge» = 61, ikke 246** — de øvrige kontoene er trolig eksterne/kunde-/servicekontoer.
  «Alle deltakere»-tildeling må være eksplisitt om populasjon.
- **Flagg:** app-rolle-gruppene `a2-assessment-prod-participants` / `-subject-matter-owners` finnes,
  men har **0 medlemmer** — plattform-roller drives *ikke* av disse i dag. Rolle-tildelingsstien
  (ENTRA_ROLE_MAP / DB) må forstås separat før vi antar gruppe→rolle.

**Konsekvens for medlemskaps-kilde:** maks ~35 grupper/bruker er langt under Entra-token-ets
**200-gruppers «overage»-grense** — `groups`-claim-et i ID-token-et er derfor en *pålitelig og
komplett* kilde til en brukers medlemskap ved login. Ingen Graph-`memberOf`-fallback nødvendig for
*medlemskap*. (En **katalog** over gruppenavn til et tildelings-UI er en egen sak — se §3/§4.)

## 3. Alt A — Entra-synkede grupper (dynamisk)
Bruk de eksisterende M365-gruppene som kohorter.

**Modell:**
| Tabell | Felt | Notat |
|---|---|---|
| `CohortGroup` | id, entraGroupId (unik), displayName, syncedAt, archivedAt? | katalog synket fra Entra |
| `CourseGroupAssignment` | id, courseId (FK Cascade), cohortGroupId (FK), dueAt?, assignedById?, createdAt | dynamisk tildeling |

- **Medlemskap lagres ikke** — en bruker er «tildelt» et kurs hvis `tokenGroups ∩ tildelte gruppe-IDer ≠ ∅`,
  evaluert ved request-tid. (Token-gruppene ligger allerede i `principal.groupIds`.)
- **Katalog-synk:** en periodisk/utløst jobb henter gruppe-`id`+`displayName` (Graph `GET /groups`) inn i
  `CohortGroup` slik at tildelings-UI-et (#642) kan vise en velgbar liste. Kun metadata, ikke medlemskap.
- Synlighetsfilter + «mine tildelte kurs» utvides: et RESTRICTED-kurs er synlig hvis bruker har en
  individuell `CourseEnrollment` **eller** er medlem av en tildelt `CohortGroup`.

**Fordeler:** organisasjonens *eksisterende* struktur gjenbrukes; medlemskap er alltid ferskt (Entra er
sannhetskilde); ingen dobbeltvedlikehold; «KI strategi får KI-kurset» faller naturlig ut.
**Ulemper:** avhenger av Graph-tilgang (katalog-synk krever `Group.Read.All` app-permission +
admin-consent); 198 grupper inkluderer mye støy (sosiale, interne, kunde-grupper) → trenger filtrering/
kuratering av hvilke som er «kurs-tildelbare»; gruppenavn/eierskap styres utenfor plattformen;
token-gruppene oppdateres først ved neste login (akseptabelt for kurstildeling).

## 4. Alt B — Manuelle «klasser» i løsningen
Plattform-eide kohorter som admin definerer og fyller selv — uavhengig av Entra.

**Modell:**
| Tabell | Felt | Notat |
|---|---|---|
| `Class` | id, name, description?, createdById, createdAt, archivedAt? | plattform-eid kohort («klasse») |
| `ClassMember` | classId (FK Cascade), userId (FK Cascade), addedById, addedAt | mange-til-mange medlemskap |
| `CourseGroupAssignment` | courseId, classId, dueAt?, … | tildel kurs til en klasse |

- Admin/SMO oppretter en **klasse** («Onboarding H2026», «Saksbehandlere kommune X»), søker opp og
  **legger til studenter** manuelt, og tildeler kurs til klassen.
- Medlemskap er **eksplisitt lagret** → server-side spørringer er trivielle («list medlemmer», «hvem
  mangler»), og tildeling kan materialiseres eller evalueres dynamisk fra `ClassMember`.

**Fordeler:** ingen Entra-/Graph-avhengighet; full kontroll og sporbarhet i plattformen; kohorter kan
være kurs-spesifikke (en «klasse» som ikke finnes i AD, f.eks. blandet ansatte + eksterne); enkel,
selvforklarende UX; ingen støy fra 198 AD-grupper.
**Ulemper:** **manuelt vedlikehold** — noen må holde klasse-medlemskap à jour for hånd (driver mot at
det ruster); dupliserer informasjon som *allerede* finnes i Entra (de 35 gruppene en bruker er i);
 skaleringsfriksjon ved mange/store kull; «add 200 studenter» er tungt uten import.

## 5. Alt C — Hybrid (anbefalt retning)
Begge mekanismer, samme tildelings-abstraksjon:

- En **klasse** kan være enten **manuell** (`ClassMember`-rader) eller **Entra-koblet**
  (`entraGroupId` satt → medlemskap = token-gruppemedlemskap, ingen `ClassMember`-rader).
- `CourseGroupAssignment` peker på en `Class` uansett type → tildelings-UI, synlighet og «mine kurs»
  bryr seg ikke om kilden.

```
Class { id, name, kind: MANUAL | ENTRA, entraGroupId?, description?, isSystem?, archivedAt? }
ClassMember { classId, userId }            // kun for kind=MANUAL
CourseGroupAssignment { courseId, classId, dueAt? }
```

Medlemskap-evaluering: `kind=MANUAL` → `ClassMember`; `kind=ENTRA` → `principal.groupIds`. Dette gir
organisasjonen Entra-gjenbruk *der det passer* og manuelle ad-hoc-kull *der det trengs*, uten to
separate tildelings-stier.

**Konfigurerbar Entra-kobling (eier-beslutning 1).** En plattform-config (`PlatformConfig`-nøkkel,
f.eks. `classEntraLinkingEnabled`, **default av**) styrer om `kind=ENTRA`-klasser i det hele tatt er
tilgjengelig. Når av: kun manuelle klasser kan opprettes/brukes, og evaluering av eksisterende
ENTRA-klasser kan deaktiveres. Administrator slår dette på når Graph-app-permission er på plass og
gruppene er kuratert. Dette holder v1 (kun manuelle klasser) ren og lar Entra-kobling aktiveres senere
uten kodeendring.

**Systemklasse «Alle deltakere» (eier-beslutning 4).** En `isSystem`-klasse med eksplisitt populasjon
= alle med PARTICIPANT-rolle (ikke en AD-gruppe), så «tildel til alle deltakere» betyr noe entydig.

## 6. Sammenligning
| Kriterium | A: Entra-synk | B: Manuelle klasser | C: Hybrid |
|---|---|---|---|
| Gjenbruk av eksisterende struktur | ✅ full | ❌ ingen | ✅ valgfri |
| Medlemskap alltid ferskt | ✅ (Entra) | ➖ manuelt | ✅ for ENTRA-klasser |
| Vedlikeholdsbyrde | ✅ lav | ❌ høy | ➖ middels |
| Ad-hoc / blandede kull (eksterne) | ❌ vanskelig | ✅ enkelt | ✅ enkelt |
| Avhengigheter | Graph app-perm + consent | ingen | Graph (kun ENTRA-klasser) |
| UX-kompleksitet | ➖ kuratere AD-støy | ✅ enkel | ➖ to typer |
| Byggekostnad (agent-timer) | middels | lav–middels | middels–høy |

## 7. Besluttet retning + dekomponering
**Retning (besluttet 2026-06-25):** hybrid datamodell (`Class.kind: MANUAL | ENTRA`), men **v1
implementerer kun manuelle klasser**. Entra-kobling er gated bak en Administrator-config (default av)
og bygges som egen senere skive. Tildeling er **dynamisk**, `User.department` **slettes**, og «Alle
deltakere» er en **systemklasse** (PARTICIPANT-populasjon).

**Foreslått dekomponering (nye CL-skiver under #496/EPIC #478):**
- **CL-1 Datamodell:** `Class` + `ClassMember` + `CourseGroupAssignment` + migrasjon; seed «Alle
  deltakere»-systemklasse; `PlatformConfig.classEntraLinkingEnabled` (default av).
- **CL-2 API + authz:** opprett/arkiver klasse, legg til/fjern medlem, tildel/avtildel kurs til klasse;
  dynamisk synlighet + «mine kurs» utvides til klasse-medlemskap; audit.
- **CL-3 Admin-UI:** klasse-administrasjon (opprett, søk+legg til studenter) + tildel kurs til klasse
  (erstatter/avløser EN-3 #642 sin avdelings-tanke).
- **CL-4 Fjern `User.department`:** drop-kolonne-migrasjon + fjern fra schema/principal/orgSync + fjern
  EN-2 sin `DEPARTMENT`-gren (kilde-enum beholdes for historikk, ny kilde `CLASS`). *Egen liten skive
  siden den rører allerede levert EN-2 og er en schema-drop — ikke buntes med en pågående release.*
- **CL-5 (senere) Entra-kobling:** Graph `Group.Read.All` app-perm + admin-consent, gruppe-katalog-synk,
  `kind=ENTRA`-klasser, Administrator-kuratering. Aktiveres via config-toggle.

## 8. Konsekvens for allerede levert kode (EN-1/EN-2)
- `CourseEnrollment` (individuell + selv-påmelding) **beholdes** uendret.
- EN-2 sin **`DEPARTMENT`-gren** (`assignEnrollments({ department })` mot `User.department`) **fjernes**
  (CL-4) — `User.department`-kolonnen slettes (beslutning 3), og den grenen har uansett ingen
  produksjonsbruk («sekundær til data finnes»).
- `CourseEnrollmentSource.DEPARTMENT` beholdes i enum for historikk; ny kilde for klasse-tildeling er
  `CLASS`.
- Synlighetsfilteret (`filterVisibleCourseIds`) utvides til å også slippe gjennom kurs tildelt en klasse
  brukeren er medlem av.
- **`User.department`-sletting (CL-4)** rører: `prisma/schema.prisma` (drop column + migrasjon),
  `src/auth/principal.ts` + `authenticate.ts` (`x-user-department` / claim), `orgSyncService.ts`
  (department-felt + `allowDepartmentOverwrite`), EN-2 `assignEnrollments`. Egen skive, ikke i en
  pågående release.

## 9. Sikkerhet / personvern
- AD-utforskningen var **read-only** (gruppe-metadata + medlemskaps-antall), kjørt mot prod-tenanten med
  eksplisitt subscription-bytte og tilbakebytte (per CLAUDE.md tenant-disiplin). Ingen data skrevet.
- For Alt A/C kreves Graph **applikasjons**-permission (`Group.Read.All`) med admin-consent — egen
  infra-/sikkerhetssak; ikke nødvendig for Alt B.
- `ClassMember` er personhenførbart (hvem er i hvilket kull) → omfattes av eksisterende sletteflyt
  (`onDelete: Cascade` på `userId`).
