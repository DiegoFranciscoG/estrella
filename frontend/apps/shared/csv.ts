/**
 * Spreadsheet-ready CSV: semicolons and decimal commas (Spanish spreadsheets), UTF-8 with BOM so
 * accents survive, and text that starts like a formula neutralised (OWASP: CSV injection).
 */
export function csv(rows: (string | number | null)[][], decimals = 2): string {
  const cell = (v: string | number | null): string => {
    if (v === null) return "";
    if (typeof v === "number") {
      return Number.isFinite(v) ? v.toLocaleString("es", { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: false }) : "";
    }
    // OWASP's list: = + - @, tab, carriage return, line feed, and their full-width forms.
    const safe = /^[=+\-@\t\r\n＝＋－＠]/.test(v) ? `'${v}` : v;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  return "\uFEFF" + rows.map((row) => row.map(cell).join(";")).join("\r\n") + "\r\n";
}
