// Maskotpakken i nettleseren (doc/design/MASKOTPAKKE.md), montert på /static foran de statiske mappene:
//   /static/mascot/<navn>/...   filene i pakken (bildene, figuren, faviconet)
//   /static/boat/...            alias for bildene (skive 1), så en åpen, gammel fane ikke får ødelagte bilder
//   /static/mascot/moods.json   humørene for profilen, laget av pakken
//   /static/mascot/figure.js    figuren for «Mine kurs» som JS-modul, laget av pakken
//   /static/mascot/figure.css   figurens stil
//   /static/favicon.svg m.fl.   faviconet, på de faste adressene sidene lenker til
// Hvilken adresse som gir hva, avgjøres i mascotPack.ts (`resolveMascotRequest`), som testserveren for e2e også bruker.
import { Router } from "express";
import { activeMascot, resolveMascotRequest } from "../modules/mascot/mascotPack.js";

export const mascotRouter = Router();
const pack = activeMascot();

mascotRouter.get(/^\/(?:mascot|boat|favicon|apple-touch-icon)/, (request, response, next) => {
  const hit = resolveMascotRequest(pack, `/static${request.path}`);
  if (!hit) {
    next();
    return;
  }
  if (hit.kind === "body") {
    response.setHeader("Content-Type", hit.contentType);
    // Laget av pakken, som byttes ved en utrulling: nettleseren spør på nytt hver gang (ETag gir 304).
    response.setHeader("Cache-Control", "no-cache");
    response.send(hit.body);
    return;
  }
  response.sendFile(hit.file, (error) => {
    if (error) next(error);
  });
});
