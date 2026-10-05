// Bygger en liten, ekte .pptx i minnet, til testene av `pptx-extract.mjs` (#1079).
//
// En ekte presentasjon kan ikke ligge i repoet: de er på 17–20 MB og er forfatterens eget innhold.
// Denne lager en zip med akkurat de delene skriptet leser — presentasjonen, lysarkene, notater,
// SmartArt-data, tema og bilder — og ingenting annet. Zip-en skrives ukomprimert; skriptet leser
// begge slag.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** En zip med ukomprimerte filer. */
export function zip(files: Record<string, string | Buffer>): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = typeof content === "string" ? Buffer.from(content, "utf8") : content;
    const nameBytes = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    local.push(header, nameBytes, data);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

const EMU = 12700;
const xfrm = (x: number, y: number, w: number, h: number) => `<a:xfrm><a:off x="${x * EMU}" y="${y * EMU}"/><a:ext cx="${w * EMU}" cy="${h * EMU}"/></a:xfrm>`;
const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export type Line = string | { text: string; bullet?: boolean; bold?: boolean; level?: number; size?: number };
const paragraph = (line: Line) => {
  const l = typeof line === "string" ? { text: line } : line;
  const pPr = `${l.level ? `<a:pPr lvl="${l.level}">` : "<a:pPr>"}${l.bullet ? '<a:buChar char="•"/>' : ""}</a:pPr>`;
  return `<a:p>${pPr}<a:r><a:rPr lang="nb-NO"${l.bold ? ' b="1"' : ""}${l.size ? ` sz="${l.size * 100}"` : ""}/><a:t>${esc(l.text)}</a:t></a:r></a:p>`;
};
const body = (lines: Line[]) => (lines.length ? `<p:txBody><a:bodyPr/>${lines.map(paragraph).join("")}</p:txBody>` : "");

export interface ShapeOptions { geometry?: string; fill?: string | null; text?: Line[]; textBox?: boolean; placeholder?: string | true }
/** En form: rektangel, sirkel, pil, tekstboks eller plassholder. `box` utelates for en plassholder som arver plassen sin. */
export function shape(box: [number, number, number, number] | null, options: ShapeOptions = {}): string {
  const ph = options.placeholder === true ? '<p:nvPr><p:ph idx="1"/></p:nvPr>' : options.placeholder ? `<p:nvPr><p:ph type="${options.placeholder}"/></p:nvPr>` : "<p:nvPr/>";
  const fill = options.fill === null ? "<a:noFill/>" : options.fill ? `<a:solidFill><a:srgbClr val="${options.fill.replace("#", "").toUpperCase()}"/></a:solidFill>` : "";
  const geometry = options.geometry ? `<a:prstGeom prst="${options.geometry}"><a:avLst/></a:prstGeom>` : "";
  return `<p:sp><p:nvSpPr><p:cNvPr id="1" name="form"/><p:cNvSpPr${options.textBox ? ' txBox="1"' : ""}/>${ph}</p:nvSpPr><p:spPr>${box ? xfrm(...box) : ""}${geometry}${fill}</p:spPr>${body(options.text ?? [])}</p:sp>`;
}
/** Et bilde. `svgRel` settes for et ikon som også har en SVG-utgave, slik PowerPoint lagrer dem. */
export function picture(box: [number, number, number, number], rel: string, svgRel?: string): string {
  const svg = svgRel ? `<a:extLst><a:ext uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}"><asvg:svgBlip xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main" r:embed="${svgRel}"/></a:ext></a:extLst>` : "";
  return `<p:pic><p:nvPicPr><p:cNvPr id="2" name="bilde"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rel}">${svg}</a:blip></p:blipFill><p:spPr>${xfrm(...box)}</p:spPr></p:pic>`;
}
export const connector = (box: [number, number, number, number]) => `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="3" name="strek"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr>${xfrm(...box)}</p:spPr></p:cxnSp>`;
export const table = (rows: string[][]) =>
  `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="4" name="tabell"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${40 * EMU}" y="${150 * EMU}"/><a:ext cx="${800 * EMU}" cy="${200 * EMU}"/></p:xfrm><a:graphic><a:graphicData><a:tbl>${rows.map((row) => `<a:tr h="1">${row.map((cell) => `<a:tc><a:txBody><a:bodyPr/>${paragraph(cell)}</a:txBody></a:tc>`).join("")}</a:tr>`).join("")}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
export const smartArt = (dataRel: string) =>
  `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="5" name="smartart"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="${800 * EMU}" cy="${300 * EMU}"/></p:xfrm><a:graphic><a:graphicData><dgm:relIds xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" r:dm="${dataRel}"/></a:graphicData></a:graphic></p:graphicFrame>`;
/** En gruppe: barna står i gruppens eget koordinatsystem (`child`), og tegnes i `box`. */
export const group = (box: [number, number, number, number], child: [number, number, number, number], children: string[]) =>
  `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="6" name="gruppe"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="${box[0] * EMU}" y="${box[1] * EMU}"/><a:ext cx="${box[2] * EMU}" cy="${box[3] * EMU}"/><a:chOff x="${child[0] * EMU}" y="${child[1] * EMU}"/><a:chExt cx="${child[2] * EMU}" cy="${child[3] * EMU}"/></a:xfrm></p:grpSpPr>${children.join("")}</p:grpSp>`;

export interface SlideSpec {
  shapes: string[];
  /** rel-id → sti under ppt/ (f.eks. "media/image1.png"), og innholdet i fila. */
  media?: Record<string, { path: string; content: string | Buffer }>;
  notes?: string;
  /** SmartArt-punktene, hvis lysarket har en `smartArt("rIdDgm")`. */
  diagram?: string[];
}

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const relsFile = (rels: Array<[string, string, string]>) => `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.map(([id, type, target]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`).join("")}</Relationships>`;

/** En .pptx på 960 × 540 punkt med lysarkene som er oppgitt. */
export function buildPptx(slides: SlideSpec[]): Buffer {
  const files: Record<string, string | Buffer> = {
    "ppt/presentation.xml": `<?xml version="1.0"?><p:presentation ${NS}><p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`).join("")}</p:sldIdLst><p:sldSz cx="${960 * EMU}" cy="${540 * EMU}"/></p:presentation>`,
    "ppt/_rels/presentation.xml.rels": relsFile(slides.map((_, i) => [`rId${i + 1}`, "slide", `slides/slide${i + 1}.xml`])),
    "ppt/theme/theme1.xml": `<?xml version="1.0"?><a:theme ${NS}><a:themeElements><a:clrScheme name="t"><a:dk1><a:srgbClr val="111111"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:accent1><a:srgbClr val="336699"/></a:accent1></a:clrScheme></a:themeElements></a:theme>`,
  };
  slides.forEach((slide, i) => {
    const n = i + 1;
    files[`ppt/slides/slide${n}.xml`] = `<?xml version="1.0"?><p:sld ${NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${slide.shapes.join("")}</p:spTree></p:cSld></p:sld>`;
    const rels: Array<[string, string, string]> = [];
    for (const [id, media] of Object.entries(slide.media ?? {})) {
      rels.push([id, "image", `../${media.path}`]);
      files[`ppt/${media.path}`] = media.content;
    }
    if (slide.notes !== undefined) {
      rels.push(["rIdNotes", "notesSlide", `../notesSlides/notesSlide${n}.xml`]);
      files[`ppt/notesSlides/notesSlide${n}.xml`] = `<?xml version="1.0"?><p:notes ${NS}><p:cSld><p:spTree>${shape(null, { placeholder: "sldNum", text: [String(n)] })}${shape(null, { placeholder: "body", text: [slide.notes] })}</p:spTree></p:cSld></p:notes>`;
    }
    if (slide.diagram) {
      rels.push(["rIdDgm", "diagramData", `../diagrams/data${n}.xml`]);
      files[`ppt/diagrams/data${n}.xml`] = `<?xml version="1.0"?><dgm:dataModel xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><dgm:ptLst>${slide.diagram.map((text) => `<dgm:pt modelId="x"><dgm:t><a:bodyPr/>${paragraph(text)}</dgm:t></dgm:pt>`).join("")}<dgm:pt modelId="tom" type="pres"><dgm:prSet/></dgm:pt></dgm:ptLst></dgm:dataModel>`;
    }
    files[`ppt/slides/_rels/slide${n}.xml.rels`] = relsFile(rels);
  });
  return zip(files);
}

/** Starten på en PNG med oppgitt størrelse — nok til at størrelsen kan leses, ikke et bilde som kan vises. */
export function pngHeader(width: number, height: number): Buffer {
  const b = Buffer.alloc(40);
  b.writeUInt32BE(0x89504e47, 0);
  b.writeUInt32BE(0x0d0a1a0a, 4);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "ascii");
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}
