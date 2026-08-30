/**
 * #1046 — fyller mock-innloggingens identitetsfelt, ett sted.
 *
 * ⚠️ HVORFOR DENNE FINNES. Mønsteret lå i SJU filer: `participant`, `participant-completed`,
 * `admin-platform`, `profile`, `review`, `results` og `cohort-status`.
 * `scripts/dev/similar-function-scan.mjs` fant bare to av dem som 100 % like — resten avvek nok til
 * å slippe under grensen, og det er nettopp poenget: de hadde driftet.
 *
 * ⚠️ OG DE HADDE ULIK FORSVARLIGHET. `results.js` null-sjekker hvert felt før det settes. De andre
 * gjør `document.getElementById("userId").value = …` rett fram, og **kaster** hvis feltet ikke
 * finnes på den siden. Denne modulen tar den forsvarlige varianten.
 *
 * ⚠️ HVA SOM IKKE ER FELLES, og derfor blir igjen hos hver flate: HVILKEN rolle som leses.
 * Sensorflaten bruker `reviewWorkspace ?? reviewer`, kohortstatus `contentAdmin ?? reportReader`,
 * deltakerflaten `participant`. Det er en reell forskjell mellom flatene, ikke drift — så den skal
 * ikke gjemmes i en felles funksjon.
 *
 * @param {object | null | undefined} defaults  ferdig oppslått standardidentitet
 * @param {HTMLInputElement | null} rolesInput  rollefeltet, som har ulikt navn per flate
 */
export function applyIdentityDefaults(defaults, rolesInput) {
  if (!defaults) return;

  for (const felt of ["userId", "email", "name", "department"]) {
    const el = document.getElementById(felt);
    if (el) el.value = defaults[felt] ?? "";
  }

  if (rolesInput) {
    rolesInput.value = Array.isArray(defaults.roles) ? defaults.roles.join(",") : "";
  }
}
