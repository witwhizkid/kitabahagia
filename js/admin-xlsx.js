// Minimal .xlsx writer for the admin registrant export (Oct 2026): one styled sheet in KB colours,
// built in the browser as an uncompressed ZIP, so no spreadsheet library has to be loaded.
// KBXlsx.build({ sheetName, title, subtitle, columns: [{ label, width, kind }], rows }) -> Blob
// Cell values: string, number, Date (shown as WIB date-time) or { value, tone } where tone is
// green | gold | cream | grey (coloured status pill).
(() => {
  "use strict";

  const encoder = new TextEncoder();
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (bytes) => {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  };

  // Stored (no compression) ZIP: local headers, data, central directory, end record.
  const zip = (files) => {
    const parts = [];
    const central = [];
    let offset = 0;
    files.forEach(({ name, text }) => {
      const nameBytes = encoder.encode(name);
      const data = encoder.encode(text);
      const crc = crc32(data);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true); // UTF-8 names
      local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, nameBytes.length, true);
      parts.push(local, nameBytes, data);
      const entry = new DataView(new ArrayBuffer(46));
      entry.setUint32(0, 0x02014b50, true);
      entry.setUint16(4, 20, true);
      entry.setUint16(6, 20, true);
      entry.setUint16(8, 0x0800, true);
      entry.setUint32(16, crc, true);
      entry.setUint32(20, data.length, true);
      entry.setUint32(24, data.length, true);
      entry.setUint16(28, nameBytes.length, true);
      entry.setUint32(42, offset, true);
      central.push(entry, nameBytes);
      offset += 30 + nameBytes.length + data.length;
    });
    const centralSize = central.reduce((sum, part) => sum + part.byteLength, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
  };

  const escapeXml = (value) => String(value ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const columnName = (index) => {
    let name = "";
    for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
    return name;
  };
  // Excel serial date in WIB (UTC+7), so times match what the admin page shows.
  const excelDate = (date) => (date.getTime() + 7 * 3600000) / 86400000 + 25569;

  // Palette: maroon #7A1F2B, cream #F6E6D6, paper #FBF8F4, ink #231F20 (same tokens as the site).
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="[$-421]d mmm yyyy, hh:mm"/></numFmts>
<fonts count="8">
<font><sz val="11"/><color rgb="FF231F20"/><name val="Calibri"/></font>
<font><b/><sz val="16"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
<font><sz val="10"/><color rgb="FFF6E6D6"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FF7A1F2B"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FF1E6B34"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FF8F5D00"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FF53141D"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FF6F6667"/><name val="Calibri"/></font>
</fonts>
<fills count="8">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF7A1F2B"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF6E6D6"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFBF8F4"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE3F1E5"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFF0C7"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFECE8E4"/></patternFill></fill>
</fills>
<borders count="3">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left/><right/><top/><bottom style="thin"><color rgb="FFE5D8CF"/></bottom><diagonal/></border>
<border><left/><right/><top/><bottom style="medium"><color rgb="FF7A1F2B"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="14">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" indent="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="top" indent="1"/></xf>
<xf numFmtId="0" fontId="3" fillId="3" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" horizontal="left"/></xf>
<xf numFmtId="164" fontId="0" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" horizontal="left"/></xf>
<xf numFmtId="0" fontId="4" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" horizontal="center"/></xf>
<xf numFmtId="0" fontId="5" fillId="6" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" horizontal="center"/></xf>
<xf numFmtId="0" fontId="6" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" horizontal="center"/></xf>
<xf numFmtId="0" fontId="7" fillId="7" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" horizontal="center"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
  const toneStyle = { green: 10, gold: 11, cream: 12, grey: 13 };

  const cell = (ref, value, style) => {
    if (value === null || value === undefined || value === "") return `<c r="${ref}" s="${style}"/>`;
    if (typeof value === "number" && Number.isFinite(value)) return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
    return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
  };

  const sheetXml = ({ title, subtitle, columns, rows }) => {
    const last = columnName(columns.length - 1);
    const headerRow = 4;
    const lastRow = headerRow + Math.max(rows.length, 1);
    const cols = columns.map((column, index) => `<col min="${index + 1}" max="${index + 1}" width="${column.width || 16}" customWidth="1"/>`).join("");
    const body = rows.map((row, rowIndex) => {
      const r = headerRow + 1 + rowIndex;
      const alt = rowIndex % 2 === 1;
      const cells = columns.map((column, index) => {
        const ref = `${columnName(index)}${r}`;
        let value = row[index];
        if (value && typeof value === "object" && !(value instanceof Date)) {
          return cell(ref, value.value, value.value ? toneStyle[value.tone] ?? (alt ? 5 : 4) : (alt ? 5 : 4));
        }
        if (value instanceof Date) {
          return Number.isNaN(value.getTime()) ? cell(ref, "", alt ? 5 : 4) : cell(ref, excelDate(value), alt ? 9 : 8);
        }
        if (column.kind === "number") value = value === "" || value === null || value === undefined ? "" : Number(value);
        return cell(ref, value, column.kind === "wrap" ? (alt ? 7 : 6) : (alt ? 5 : 4));
      }).join("");
      return `<row r="${r}">${cells}</row>`;
    }).join("");
    const filler = (r, style) => columns.slice(1).map((_, index) => `<c r="${columnName(index + 1)}${r}" s="${style}"/>`).join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="18"/>
<cols>${cols}</cols>
<sheetData>
<row r="1" ht="34" customHeight="1">${cell("A1", title, 1)}${filler(1, 1)}</row>
<row r="2" ht="20" customHeight="1">${cell("A2", subtitle, 2)}${filler(2, 2)}</row>
<row r="3" ht="8" customHeight="1"></row>
<row r="${headerRow}" ht="30" customHeight="1">${columns.map((column, index) => cell(`${columnName(index)}${headerRow}`, column.label, 3)).join("")}</row>
${body}
</sheetData>
<autoFilter ref="A${headerRow}:${last}${lastRow}"/>
<mergeCells count="2"><mergeCell ref="A1:${last}1"/><mergeCell ref="A2:${last}2"/></mergeCells>
<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>
<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;
  };

  const build = ({ sheetName = "Pendaftar", ...sheet }) => {
    const safeName = escapeXml(String(sheetName).replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Pendaftar");
    const lastRow = 4 + Math.max(sheet.rows.length, 1);
    return zip([
      { name: "[Content_Types].xml", text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` },
      { name: "_rels/.rels", text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
      { name: "xl/workbook.xml", text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${safeName}" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${safeName.replace(/'/g, "''")}'!$A$4:$${columnName(sheet.columns.length - 1)}$${lastRow}</definedName></definedNames></workbook>` },
      { name: "xl/_rels/workbook.xml.rels", text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
      { name: "xl/styles.xml", text: styles },
      { name: "xl/worksheets/sheet1.xml", text: sheetXml(sheet) },
    ]);
  };

  window.KBXlsx = { build };
})();
