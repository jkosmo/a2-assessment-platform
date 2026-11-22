// 2.168.0: de gamle seksjonsrutene (`PUT …/content` og «Oversett», `POST …/assets/localize`) er borte. Stage-testene lagrer
// som redigereren gjør: `PUT …/:id` med versjonen og tittelen fanen så. Med `sourceLocale` oversettes figurene teksten viser,
// og som den publiserte versjonen ikke viser (#1163 skive 2). En lagring er et utkast; `publiser` legger den ut etterpå.

type Svar = { status: number; json: any; tekst: string };
type Api = (metode: string, sti: string, body?: unknown) => Promise<Svar>;

const kart = (raw: unknown): Record<string, string> => {
  if (raw && typeof raw === "object") return raw as Record<string, string>;
  try {
    const verdi = JSON.parse(String(raw));
    if (verdi && typeof verdi === "object") return verdi as Record<string, string>;
  } catch { /* ren tekst */ }
  return { nb: String(raw) };
};

export async function lagreSeksjon(
  api: Api,
  sectionId: string,
  endring: { bodyMarkdown?: Record<string, string>; sourceLocale?: string; publiser?: boolean },
): Promise<{ lagret: Svar; publisert?: Svar }> {
  const sti = `/api/admin/content/sections/${sectionId}`;
  const detalj = await api("GET", sti);
  if (detalj.status !== 200) throw new Error(`GET seksjonen svarte ${detalj.status}: ${detalj.tekst.slice(0, 200)}`);
  const fane = detalj.json.section as { title: string; bodyMarkdown: string; versionNo: number };
  const lagret = await api("PUT", sti, {
    title: kart(fane.title),
    bodyMarkdown: endring.bodyMarkdown ?? kart(fane.bodyMarkdown),
    expectedVersionNo: fane.versionNo,
    expectedTitle: fane.title,
    ...(endring.sourceLocale ? { sourceLocale: endring.sourceLocale } : {}),
  });
  if (!endring.publiser || lagret.status !== 200) return { lagret };
  const publisert = await api("POST", `${sti}/publish`, { expectedVersionNo: lagret.json.section.versionNo });
  return { lagret, publisert };
}
