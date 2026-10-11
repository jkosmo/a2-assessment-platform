// GET /static/icons/<navn>.svg — ett ikon fra plattformens eget bibliotek (Lucide), tegnet i
// plattformens tekstfarge. Åpen, uten innlogging: ikonene er ikke innhold, og en <img> i
// seksjonstekst kan ikke bære et token. Et navn som ikke finnes gir 404, aldri et tomt bilde.
import { Router } from "express";
import { ICON_NAME_RE, iconSvg } from "../modules/course/iconLibrary.js";

export const iconsRouter = Router();

iconsRouter.get("/:file", (request, response) => {
  const file = String(request.params.file ?? "");
  const name = file.endsWith(".svg") ? file.slice(0, -4) : "";
  const svg = ICON_NAME_RE.test(name) ? iconSvg(name) : null;
  if (!svg) {
    response.status(404).json({ error: "unknown_icon", message: `No icon named "${name}" in the platform's icon library.` });
    return;
  }
  response.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
  // Biblioteket er sjekket inn og byttes bare ved en utrulling; en dag i mellomlageret er trygt.
  response.setHeader("Cache-Control", "public, max-age=86400");
  response.send(svg);
});
