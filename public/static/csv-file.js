// En CSV-fil laget i nettleseren av det som står på skjermen, for å åpnes i norsk Excel:
// semikolon skiller kolonnene, og merket først i fila får Excel til å lese æøå riktig.

const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);
// Samme vern som serveren (src/modules/reporting/csvExport.ts): en celle som starter slik, kjøres som en formel i Excel.
const FORMULA_START = /^[=+\-@\t\r]/;

function cell(value) {
  const text = value == null ? "" : String(value);
  const guarded = FORMULA_START.test(text) ? `'${text}` : text;
  return /[;"\r\n]/.test(guarded) ? `"${guarded.replaceAll('"', '""')}"` : guarded;
}

export function saveCsvFile(fileName, header, rows) {
  const lines = [header, ...rows].map((row) => row.map(cell).join(";"));
  const blob = new Blob([BYTE_ORDER_MARK + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(link.href);
}
