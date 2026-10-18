export const escapeHtml = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function reportTable(
  rows: Record<string, unknown>[],
  headers: string[],
) {
  return `<table><thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.map((r) => `<tr>${headers.map((h) => `<td${typeof r[h] === "number" ? ' class="number"' : ""}>${escapeHtml(r[h])}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${headers.length}">No records</td></tr>`}</tbody></table>`;
}
export function reportDocument(title: string, subtitle: string, body: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page{size:A4 landscape;margin:12mm}*{box-sizing:border-box}body{font:11px Arial,sans-serif;color:#202e28;margin:0}
    h1{font-size:25px;margin:0 0 8px}h2{font-size:16px;margin:24px 0 10px;break-after:avoid}
    p{line-height:1.5;overflow-wrap:anywhere}table{border-collapse:collapse;width:100%;table-layout:fixed}
    th,td{text-align:left;padding:7px 6px;border-bottom:1px solid #dfe5dc;vertical-align:top;overflow-wrap:anywhere}
    th{background:#184d3e;color:white}tbody tr:nth-child(even){background:#f2f5ef}
    thead{display:table-header-group}tr{break-inside:avoid;page-break-inside:avoid}.number{text-align:right;font-variant-numeric:tabular-nums}
    </style></head><body><h1>${escapeHtml(title)}</h1><p>${escapeHtml(subtitle)}</p>${body}</body></html>`;
}
