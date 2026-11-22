// Det som regnes som en adresse i en e-post (#1141, lenkene): `http:`, `https:` eller `www.`. Malen i
// illustratedEmail.ts nekter å sende en e-post med noe slikt utenom vår egen lenke, og sjekken av maskotpakken
// (mascot/mascotCheck.ts) bruker samme regel på bildetekstene og tekstene i pakken, så en pakke aldri kan stoppe en
// e-post. Egen fil uten avhengigheter, så sjekken kan bruke regelen uten å laste e-postmalen (og dermed pakken).
export const LINK_LIKE = /https?:|www\./i;
