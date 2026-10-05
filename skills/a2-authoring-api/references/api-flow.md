# Creating the drafts through the API

Contents: [When](#when) · [Which installation](#which-installation) · [The token](#the-token) ·
[Running it](#running-it) · [The calls, in order](#the-calls-in-order) ·
[Adding questions to an existing module](#adding-questions-to-an-existing-module) ·
[The run id](#the-run-id) · [When something fails](#when-something-fails) · [Links for the report](#links-for-the-report)

## When

Only when you can reach the author's installation over the network **and** the author has given
you an agent token. A chat without network access delivers an import file instead
([check-and-produce.md](check-and-produce.md#delivering)).

## Which installation

The platform is installed per organisation; each installation has its own address. There is no
default. Use, in this order: an address the author gives you in this conversation; the
`A2_BASE_URL` environment variable; otherwise **ask**. Never guess an address, and never fall back
to localhost. Say the address back to the author before the first call that creates anything.

Ids of modules and sections are valid only in the installation they come from.

## The token

The author issues a short-lived agent token in their own installation (*Profil → «Agent-tilgang»*)
and pastes it into the conversation. It starts with `aat_`, is shown once, expires within the
hour, can be revoked, and can only create drafts.

- Put it in the `A2_AUTH_BEARER` environment variable for the command. Never repeat it back,
  never write it to a file, a package or a report.
- A token works only in the installation that issued it.
- If a call answers `401` in the middle of a run, the token has expired: report what was created
  so far and ask for a new one.

With an agent token the API enforces the draft rules itself: a call that would publish, or that
overwrites existing content, is answered `403 agent_token_scope`.

## Running it

Produce first, with the complete package written out
([check-and-produce.md](check-and-produce.md#through-the-api)). Then:

```
node scripts/import-package.mjs --file work/package.complete.json --base-url https://<installation> --validate-only
node scripts/import-package.mjs --file work/package.complete.json --base-url https://<installation>
```

The first asks the platform to validate the package without creating anything, and prints the
verdict. Fix every error it lists — it names the field — and validate again. The second validates
and then creates the drafts in order, printing each created object with its link, and the run id.

## The calls, in order

What the command does. Follow the same sequence if you must make the calls another way. All
bodies are JSON; all calls carry `Authorization: Bearer <token>`.

1. **Validate** — `POST /api/admin/content/agent-authoring/validate` with `{ "package": <package> }`.
   Answers `{ valid, summary, issues, plan }`. Go on only when `valid` is `true`. `plan` is the
   order of the calls below.
2. **Each section** — `POST /api/admin/content/sections` with
   `{ "title", "bodyMarkdown", "assets", "draft": true, "clientRef", "agentRunId" }`.
   `draft: true` is required. The answer holds the section's id, a link to its editor, and — when
   it has pictures — which id each `sourceId` got.
3. **Each module** — `POST /api/admin/content/modules/import` with the module wrapped as the
   command does it, `"mode": "createNew"` and `"autoPublish": false`. Both are required. The
   answer holds the module's id and links.
4. **The course** — `POST /api/admin/content/courses` with the title, description and level.
5. **The course's order** — `PUT /api/admin/content/courses/<courseId>/items` with the items,
   each `ref` replaced by the id its section or module got.

Never call an address that ends in `/publish`.

## Adding questions to an existing module

When the author names an existing module (by id) whose question bank should grow:

`POST /api/admin/content/modules/<moduleId>/mcq-questions` with
`{ "questions": [ { "stem": {…}, "options": [{…}, {…}, {…}], "correctAnswer": {…}, "rationale": {…} } ] }`

- The questions are **added** to the module's current set, as a new draft version. Nothing is
  replaced and nothing is published. 1–100 questions per call, in the same form and with the same
  three languages as in a package.
- **Read the bank first** — ask the author for the module's export, or for the existing
  questions — and write questions that test other points from the source. A bank of thirty must
  not be thirty variants of the first ten.
- Run the cue check on the new questions before you send them
  ([modules.md](modules.md#the-cue-check)).
- `409 module_has_no_mcq`: the module is free text only. `403`: the token's owner does not own
  the module.

This is the only way to change an existing module. `"mode": "replaceExisting"` is never used.

## The run id

The command makes one id per run (`aar-…`) and sends it with every call that creates something.
The platform logs each of them with that id, so a person can later see exactly what the run
made, also after a partial failure. Give the run id in your report, always.

## When something fails

- **`400 validation_error`** lists the fields at fault. Show the paths and fix the package.
- **Other errors** come as `{ error, message }`.
- **Part of the way:** the command stops at the failed call and prints what was created before
  it. Report it per step — done, failed, skipped — with ids, links, the error and the run id.
  **Delete nothing**; cleaning up or completing is the author's decision.
- **Do not simply run again.** A second run creates everything once more. After a timeout, ask
  the author to look in the library before anything is retried.

## Links for the report

| Created | Link |
|---|---|
| a module | `/admin-content/module/<moduleId>/conversation` |
| a section | `/admin-content/sections?id=<sectionId>` |
| a course | `/admin-content/courses/<courseId>` |

Close with: *"Alt er opprettet som utkast — gjennomgå og publiser manuelt i admin-UI."*
