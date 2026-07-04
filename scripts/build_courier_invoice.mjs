import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const workbook = Workbook.create();
const entry = workbook.worksheets.add("Data Entry");
const invoice = workbook.worksheets.add("Invoice");
const rates = workbook.worksheets.add("Rate Chart");
const words = workbook.worksheets.add("Words");
const calc = workbook.worksheets.add("Calc");

const outputDir = path.join(process.cwd(), "outputs", "courier_bill_generator");
const outputPath = path.join(outputDir, "courier_bill_generator_weight_tax_checked.xlsx");

function setColumnWidths(sheet, widths) {
  widths.forEach((width, index) => {
    sheet.getRangeByIndexes(0, index, 1, 1).format.columnWidthPx = width;
  });
}

function styleHeader(range, fill = "#1F4E78") {
  range.format = {
    fill,
    font: { bold: true, color: "#FFFFFF" },
    wrapText: true,
    horizontalAlignment: "center",
    verticalAlignment: "center",
  };
}

function styleInput(range) {
  range.format = {
    fill: "#FFF2CC",
    borders: { preset: "all", style: "thin", color: "#D6B656" },
    wrapText: true,
    verticalAlignment: "center",
  };
}

function styleBox(range, fill = "#F7F9FC") {
  range.format = {
    fill,
    borders: { preset: "all", style: "thin", color: "#D9E2F3" },
    wrapText: true,
  };
}

function labelValuePairs(sheet, startRow, startCol, pairs, valueSpan = 1) {
  const labelRange = sheet.getRangeByIndexes(startRow, startCol, pairs.length, 1);
  labelRange.values = pairs.map(([label]) => [label]);
  pairs.forEach(([, value], index) => {
    const valueRange = sheet.getRangeByIndexes(startRow + index, startCol + 1, 1, valueSpan);
    if (valueSpan > 1) {
      valueRange.merge();
    }
    sheet.getRangeByIndexes(startRow + index, startCol + 1, 1, 1).values = [[value]];
  });
  labelRange.format = {
    fill: "#EAF2F8",
    font: { bold: true },
    borders: { preset: "all", style: "thin", color: "#C8D6E5" },
    wrapText: true,
  };
  const valueBlock = sheet.getRangeByIndexes(startRow, startCol + 1, pairs.length, valueSpan);
  styleInput(valueBlock);
}

// DATA ENTRY SHEET
entry.showGridLines = false;
setColumnWidths(entry, [88, 170, 142, 108, 150, 118, 112, 126, 98, 104, 82, 78]);

entry.getRange("A1:L1").merge();
entry.getRange("A1").values = [["Courier Bill Generator"]];
entry.getRange("A1").format = {
  fill: "#17365D",
  font: { bold: true, color: "#FFFFFF", size: 16 },
  horizontalAlignment: "center",
};
entry.getRange("A2:L2").merge();
entry.getRange("A2").values = [["Change the yellow cells. Amount uses Rate Chart: Client/Shipper Code + Destination + Weight + PCS. Manual Amount overrides special cases."]];
entry.getRange("A2").format = { fill: "#EAF2F8", font: { italic: true }, wrapText: true };

labelValuePairs(entry, 2, 0, [
  ["Business Name", "GEETA SWARUP ENTERPRISES"],
  ["Courier Brand", "JETLINE COURIERS PVT LTD"],
  ["Address", "B GROUND FLOOR ADHARSHILA COMPLEX SOUTH GANDHI MAIDAN, PATNA"],
  ["Mobile No.", "8709210300"],
  ["State Code", "10"],
  ["SAC Code", "996812"],
], 2);
labelValuePairs(entry, 2, 3, [
  ["Bill To", "M/S BANDHAN BANK LTD"],
  ["Bill Address", "ASHOK RAJ PATH, PATNA"],
  ["GST No.", ""],
  ["Branch Code", "PATN"],
  ["Shipper Code", "BANDAN (A)"],
], 2);
labelValuePairs(entry, 2, 6, [
  ["Invoice No.", "2516/2025"],
  ["Invoice Date", new Date("2025-07-01T00:00:00")],
  ["Period Start", new Date("2025-07-01T00:00:00")],
  ["Period End", new Date("2025-07-31T00:00:00")],
  ["Page", 1],
], 2);
labelValuePairs(entry, 2, 9, [
  ["Fuel %", 0.2],
  ["CGST %", 0.09],
  ["SGST %", 0.09],
  ["Default Type", "D"],
  ["Default PCS", 1],
  ["Default WT", 0.1],
], 2);
entry.getRange("H4:I6").format.numberFormat = "dd/mm/yyyy";
entry.getRange("K3:K5").format.numberFormat = "0%";
entry.getRange("K8").format.numberFormat = "0.000";
entry.getRange("A3:L8").format.rowHeightPx = 32;

entry.getRange("A10:I10").merge();
entry.getRange("A10").values = [["Shipment Entry"]];
styleHeader(entry.getRange("A10:I10"), "#548235");
entry.getRange("A11:I11").values = [[
  "S.NO",
  "C/NO",
  "DATE",
  "DEST",
  "TYPE",
  "PCS",
  "WT (KG)",
  "MANUAL AMOUNT",
  "AMOUNT",
]];
styleHeader(entry.getRange("A11:I11"), "#305496");

const sampleRows = [
  ["13595898", new Date("2025-07-11T00:00:00"), "PATNA", "", "", "", "", ""],
  ["13595899", new Date("2025-07-11T00:00:00"), "PATNA", "", "", "", "", ""],
  ["13595900", new Date("2025-07-11T00:00:00"), "PATNA", "", "", "", "", ""],
  ["13603768", new Date("2025-07-17T00:00:00"), "DHANBAD", "", "", "", "", ""],
  ["904815399", new Date("2025-07-23T00:00:00"), "PATNA", "", "", "", "", ""],
  ["13635934", new Date("2025-07-29T00:00:00"), "PATNA", "", "", "", "", ""],
  ["13635940", new Date("2025-07-31T00:00:00"), "PATNA", "", "", "", "", ""],
  ["13635938", new Date("2025-07-31T00:00:00"), "PATNA", "", "", "", "", ""],
  ["13635939", new Date("2025-07-31T00:00:00"), "PATNA", "", "", "", "", ""],
  ["13635933", new Date("2025-07-31T00:00:00"), "DARBHANGA", "", "", "", "", ""],
];
entry.getRange("B12:I21").values = sampleRows;

const entryFormulaRows = [];
for (let row = 12; row <= 111; row += 1) {
  const lookupKey = `$E$7&"|"&$D${row}`;
  const rateRange = `'Rate Chart'!$A$3:$F$200`;
  const baseKg = `VLOOKUP(${lookupKey},${rateRange},4,FALSE)`;
  const baseRate = `VLOOKUP(${lookupKey},${rateRange},5,FALSE)`;
  const extraKgRate = `VLOOKUP(${lookupKey},${rateRange},6,FALSE)`;
  entryFormulaRows.push([
    `=IF($B${row}="","",COUNTA($B$12:B${row}))`,
    null,
    null,
    null,
    `=IF($B${row}="","",$K$6)`,
    `=IF($B${row}="","",$K$7)`,
    `=IF($B${row}="","",$K$8)`,
    null,
    `=IF($B${row}="","",IF($H${row}<>"",$H${row},IFERROR(ROUND((${baseRate}+MAX(0,$G${row}-${baseKg})*${extraKgRate})*$F${row},2),"CHECK RATE")))`,
  ]);
}
entry.getRange("A12:I111").formulas = entryFormulaRows;
entry.getRange("A12:I111").format.borders = { preset: "all", style: "thin", color: "#D9EAD3" };
entry.getRange("B12:D111").format.fill = "#FFF2CC";
entry.getRange("H12:H111").format.fill = "#FFF2CC";
entry.getRange("C12:C111").format.numberFormat = "dd/mm/yyyy";
entry.getRange("G12:G111").format.numberFormat = "0.000";
entry.getRange("H12:I111").format.numberFormat = "0.00";
entry.getRange("D12:D111").dataValidation = { rule: { type: "list", formula1: "'Rate Chart'!$C$3:$C$200" } };
entry.getRange("E12:E111").dataValidation = { rule: { type: "list", values: ["D", "P", "R"] } };
entry.getRange("E7:F7").dataValidation = { rule: { type: "list", formula1: "'Rate Chart'!$B$3:$B$200" } };
entry.freezePanes.freezeRows(11);

// RATE CHART SHEET
rates.showGridLines = false;
setColumnWidths(rates, [170, 150, 130, 86, 96, 126, 300, 24, 150, 130, 86, 70, 96]);
rates.getRange("A1:G1").merge();
rates.getRange("A1").values = [["Client + Destination Weight Pricing"]];
styleHeader(rates.getRange("A1:G1"), "#17365D");
rates.getRange("A2:G2").values = [[
  "Lookup Key (auto)",
  "Client / Shipper Code",
  "Destination",
  "Base KG",
  "Base Rate",
  "Per-KG Above Base",
  "Notes",
]];
styleHeader(rates.getRange("A2:G2"), "#305496");

const rateKeyFormulas = [];
for (let row = 3; row <= 200; row += 1) {
  rateKeyFormulas.push([`=IF(OR(B${row}="",C${row}=""),"",B${row}&"|"&C${row})`]);
}
rates.getRange("A3:A200").formulas = rateKeyFormulas;
rates.getRange("B3:G14").values = [
  ["BANDAN (A)", "PATNA", 3, 45, 15, "Bihar rule: up to 3 kg = 45; extra kg = 15"],
  ["BANDAN (A)", "BIHAR", 3, 45, 15, "Use this if you type BIHAR instead of city name"],
  ["BANDAN (A)", "DHANBAD", 3, 60, 20, "Different destination example"],
  ["BANDAN (A)", "DARBHANGA", 3, 50, 18, "Different destination example"],
  ["EXAMPLE CLIENT", "PATNA", 3, 55, 17, "Different client can have different prices"],
  ["EXAMPLE CLIENT", "DHANBAD", 3, 70, 22, "Edit or delete this sample"],
  ["", "", "", "", "", "Add more client/location rates below"],
  ["", "", "", "", "", ""],
  ["", "", "", "", "", ""],
  ["", "", "", "", "", ""],
  ["", "", "", "", "", ""],
  ["", "", "", "", "", ""],
];
rates.getRange("A3:A200").format = {
  fill: "#EAF2F8",
  borders: { preset: "all", style: "thin", color: "#C8D6E5" },
  wrapText: true,
};
rates.getRange("B3:F200").format = {
  fill: "#FFF2CC",
  borders: { preset: "all", style: "thin", color: "#D6B656" },
  wrapText: true,
};
rates.getRange("G3:G200").format = {
  fill: "#F7F9FC",
  borders: { preset: "all", style: "thin", color: "#D9E2F3" },
  wrapText: true,
};
rates.getRange("D3:F200").format.numberFormat = "0.00";
rates.freezePanes.freezeRows(2);

rates.getRange("I1:M1").merge();
rates.getRange("I1").values = [["Quick Pricing Test"]];
styleHeader(rates.getRange("I1:M1"), "#548235");
rates.getRange("I2:M2").values = [["Client", "Destination", "WT (KG)", "PCS", "Amount"]];
styleHeader(rates.getRange("I2:M2"), "#305496");
rates.getRange("I3:L5").values = [
  ["BANDAN (A)", "PATNA", 4.5, 1],
  ["EXAMPLE CLIENT", "PATNA", 4.5, 1],
  ["BANDAN (A)", "PATNA", 0.1, 1],
];
rates.getRange("M3:M5").formulas = [
  [`=IFERROR(ROUND((VLOOKUP(I3&"|"&J3,$A$3:$F$200,5,FALSE)+MAX(0,K3-VLOOKUP(I3&"|"&J3,$A$3:$F$200,4,FALSE))*VLOOKUP(I3&"|"&J3,$A$3:$F$200,6,FALSE))*L3,2),"CHECK RATE")`],
  [`=IFERROR(ROUND((VLOOKUP(I4&"|"&J4,$A$3:$F$200,5,FALSE)+MAX(0,K4-VLOOKUP(I4&"|"&J4,$A$3:$F$200,4,FALSE))*VLOOKUP(I4&"|"&J4,$A$3:$F$200,6,FALSE))*L4,2),"CHECK RATE")`],
  [`=IFERROR(ROUND((VLOOKUP(I5&"|"&J5,$A$3:$F$200,5,FALSE)+MAX(0,K5-VLOOKUP(I5&"|"&J5,$A$3:$F$200,4,FALSE))*VLOOKUP(I5&"|"&J5,$A$3:$F$200,6,FALSE))*L5,2),"CHECK RATE")`],
];
styleInput(rates.getRange("I3:L5"));
styleBox(rates.getRange("M3:M5"));
rates.getRange("K3:K5").format.numberFormat = "0.000";
rates.getRange("M3:M5").format.numberFormat = "0.00";

// INVOICE SHEET
invoice.showGridLines = false;
setColumnWidths(invoice, [52, 112, 86, 128, 58, 58, 72, 86]);

invoice.getRange("A1:H1").merge();
invoice.getRange("A1").formulas = [["='Data Entry'!$B$3"]];
invoice.getRange("A2:H2").merge();
invoice.getRange("A2").formulas = [["='Data Entry'!$B$4"]];
invoice.getRange("A3:H3").merge();
invoice.getRange("A3").formulas = [["='Data Entry'!$B$5"]];
invoice.getRange("A4:H4").merge();
invoice.getRange("A4").formulas = [[`="MOB NO : "&'Data Entry'!$B$6&"  STATE CODE : "&'Data Entry'!$B$7&"  SAC CODE : "&'Data Entry'!$B$8`]];
invoice.getRange("A1:A2").format = { font: { bold: true, size: 16 }, horizontalAlignment: "center" };
invoice.getRange("A3:A4").format = { font: { bold: true }, horizontalAlignment: "center" };

invoice.getRange("A6:D6").merge();
invoice.getRange("A7:D7").merge();
invoice.getRange("A8:D8").merge();
invoice.getRange("A9:D9").merge();
invoice.getRange("E6:H6").merge();
invoice.getRange("E7:H7").merge();
invoice.getRange("E8:H8").merge();
invoice.getRange("E9:H9").merge();
invoice.getRange("E10:H10").merge();
invoice.getRange("A6:A9").formulas = [
  [`='Data Entry'!$E$3`],
  [`='Data Entry'!$E$4`],
  [`="GST NO : "&'Data Entry'!$E$5`],
  [`="PAGE: "&'Data Entry'!$H$7`],
];
invoice.getRange("E6:E10").formulas = [
  [`="INVOICE DATE: "&TEXT('Data Entry'!$H$4,"dd/mm/yyyy")`],
  [`="BRANCH CODE : "&'Data Entry'!$E$6`],
  [`="SHIPPER CODE: "&'Data Entry'!$E$7`],
  [`="INVOICE #: "&'Data Entry'!$H$3`],
  [`="PERIOD : "&TEXT('Data Entry'!$H$5,"dd/mm/yyyy")&" TO "&TEXT('Data Entry'!$H$6,"dd/mm/yyyy")`],
];
invoice.getRange("A6:H10").format = { font: { bold: true }, wrapText: true };

invoice.getRange("A11:H11").values = [["S.NO", "C/NO", "DATE", "DEST", "TYPE", "PCS", "WT (KG)", "AMOUNT"]];
styleHeader(invoice.getRange("A11:H11"), "#D9EAD3");
invoice.getRange("A11:H11").format.font = { bold: true, color: "#000000" };

const invoiceRows = [];
for (let i = 0; i < 40; i += 1) {
  const entryRow = 12 + i;
  invoiceRows.push([
    `=IF('Data Entry'!$B${entryRow}="","",'Data Entry'!$A${entryRow})`,
    `=IF('Data Entry'!$B${entryRow}="","",'Data Entry'!$B${entryRow})`,
    `=IF('Data Entry'!$B${entryRow}="","",'Data Entry'!$C${entryRow})`,
    `=IF('Data Entry'!$B${entryRow}="","",'Data Entry'!$D${entryRow})`,
    `=IF('Data Entry'!$B${entryRow}="","",'Data Entry'!$E${entryRow})`,
    `=IF('Data Entry'!$B${entryRow}="","",'Data Entry'!$F${entryRow})`,
    `=IF('Data Entry'!$B${entryRow}="","",'Data Entry'!$G${entryRow})`,
    `=IF('Data Entry'!$B${entryRow}="","",'Data Entry'!$I${entryRow})`,
  ]);
}
invoice.getRange("A12:H51").formulas = invoiceRows;
invoice.getRange("A11:H51").format.borders = { preset: "all", style: "thin", color: "#A6A6A6" };
invoice.getRange("A12:A51").format.horizontalAlignment = "center";
invoice.getRange("E12:F51").format.horizontalAlignment = "center";
invoice.getRange("C12:C51").format.numberFormat = "dd/mm/yyyy";
invoice.getRange("G12:G51").format.numberFormat = "0.000";
invoice.getRange("H12:H51").format.numberFormat = "0.00";

invoice.getRange("E53:G53").merge();
invoice.getRange("E54:G54").merge();
invoice.getRange("E55:G55").merge();
invoice.getRange("E56:G56").merge();
invoice.getRange("E57:G57").merge();
invoice.getRange("E58:G58").merge();
invoice.getRange("E53:E58").formulas = [
  [`="G TOTAL: RS"`],
  [`="Fuel charge @ "&TEXT('Data Entry'!$K$3,"0%")&" : RS"`],
  [`="SUB TOTAL"`],
  [`="CGST @ "&TEXT('Data Entry'!$K$4,"0%")&" :"`],
  [`="SGST @ "&TEXT('Data Entry'!$K$5,"0%")&" :"`],
  [`="BILL AMOUNT"`],
];
invoice.getRange("H53:H58").formulas = [
  [`=SUM(H12:H51)`],
  [`=H53*'Data Entry'!$K$3`],
  [`=H53+H54`],
  [`=H55*'Data Entry'!$K$4`],
  [`=H55*'Data Entry'!$K$5`],
  [`=SUM(H55:H57)`],
];
invoice.getRange("E53:H58").format = { font: { bold: true }, borders: { preset: "all", style: "thin", color: "#A6A6A6" } };
invoice.getRange("H53:H58").format.numberFormat = "0.00";

invoice.getRange("A60:H60").merge();
invoice.getRange("A60").formulas = [[`="RUPEES: "&Calc!$B$13&" ONLY"`]];
invoice.getRange("A60").format = { font: { bold: true }, borders: { preset: "outside", style: "thin", color: "#A6A6A6" }, wrapText: true };
invoice.getRange("A61:H61").merge();
invoice.getRange("A61").values = [["E.& O.E."]];
invoice.getRange("A63:H63").merge();
invoice.getRange("A63").formulas = [[`="FOR "&'Data Entry'!$B$3`]];
invoice.getRange("A63").format = { font: { bold: true }, horizontalAlignment: "center" };

invoice.getRange("A1:H63").format.wrapText = true;
invoice.getRange("A1:H63").format.verticalAlignment = "center";

// WORD CONVERSION HELPERS
words.showGridLines = false;
setColumnWidths(words, [80, 120, 20, 80, 120]);
words.getRange("A1:B1").values = [["Number", "Word"]];
words.getRange("D1:E1").values = [["Number", "Word"]];
styleHeader(words.getRange("A1:B1"));
styleHeader(words.getRange("D1:E1"));
words.getRange("A2:B21").values = [
  [0, "ZERO"],
  [1, "ONE"],
  [2, "TWO"],
  [3, "THREE"],
  [4, "FOUR"],
  [5, "FIVE"],
  [6, "SIX"],
  [7, "SEVEN"],
  [8, "EIGHT"],
  [9, "NINE"],
  [10, "TEN"],
  [11, "ELEVEN"],
  [12, "TWELVE"],
  [13, "THIRTEEN"],
  [14, "FOURTEEN"],
  [15, "FIFTEEN"],
  [16, "SIXTEEN"],
  [17, "SEVENTEEN"],
  [18, "EIGHTEEN"],
  [19, "NINETEEN"],
];
words.getRange("D2:E9").values = [
  [20, "TWENTY"],
  [30, "THIRTY"],
  [40, "FORTY"],
  [50, "FIFTY"],
  [60, "SIXTY"],
  [70, "SEVENTY"],
  [80, "EIGHTY"],
  [90, "NINETY"],
];
words.getRange("A1:B21").format.borders = { preset: "all", style: "thin", color: "#D9E2F3" };
words.getRange("D1:E9").format.borders = { preset: "all", style: "thin", color: "#D9E2F3" };

calc.showGridLines = false;
setColumnWidths(calc, [150, 240]);
calc.getRange("A1:B1").values = [["Helper", "Value"]];
styleHeader(calc.getRange("A1:B1"));
calc.getRange("A2:A13").values = [
  ["Bill amount integer"],
  ["Crore"],
  ["Lakh"],
  ["Thousand"],
  ["Hundred"],
  ["Last two digits"],
  ["Crore words"],
  ["Lakh words"],
  ["Thousand words"],
  ["Hundred words"],
  ["Last words"],
  ["Final words"],
];
calc.getRange("B2:B13").formulas = [
  [`=INT(Invoice!$H$58)`],
  [`=QUOTIENT(B2,10000000)`],
  [`=QUOTIENT(MOD(B2,10000000),100000)`],
  [`=QUOTIENT(MOD(B2,100000),1000)`],
  [`=QUOTIENT(MOD(B2,1000),100)`],
  [`=MOD(B2,100)`],
  [`=IF(B3=0,"",IF(B3<20,VLOOKUP(B3,Words!$A$2:$B$21,2,FALSE),VLOOKUP(10*INT(B3/10),Words!$D$2:$E$9,2,FALSE)&IF(MOD(B3,10)>0," "&VLOOKUP(MOD(B3,10),Words!$A$2:$B$21,2,FALSE),""))&" CRORE")`],
  [`=IF(B4=0,"",IF(B4<20,VLOOKUP(B4,Words!$A$2:$B$21,2,FALSE),VLOOKUP(10*INT(B4/10),Words!$D$2:$E$9,2,FALSE)&IF(MOD(B4,10)>0," "&VLOOKUP(MOD(B4,10),Words!$A$2:$B$21,2,FALSE),""))&" LAKH")`],
  [`=IF(B5=0,"",IF(B5<20,VLOOKUP(B5,Words!$A$2:$B$21,2,FALSE),VLOOKUP(10*INT(B5/10),Words!$D$2:$E$9,2,FALSE)&IF(MOD(B5,10)>0," "&VLOOKUP(MOD(B5,10),Words!$A$2:$B$21,2,FALSE),""))&" THOUSAND")`],
  [`=IF(B6=0,"",VLOOKUP(B6,Words!$A$2:$B$21,2,FALSE)&" HUNDRED")`],
  [`=IF(B7=0,"",IF(B7<20,VLOOKUP(B7,Words!$A$2:$B$21,2,FALSE),VLOOKUP(10*INT(B7/10),Words!$D$2:$E$9,2,FALSE)&IF(MOD(B7,10)>0," "&VLOOKUP(MOD(B7,10),Words!$A$2:$B$21,2,FALSE),"")))`],
  [`=IF(B2=0,"ZERO",TRIM(B8&" "&B9&" "&B10&" "&B11&" "&B12))`],
];
calc.getRange("A1:B13").format.borders = { preset: "all", style: "thin", color: "#D9E2F3" };

await fs.mkdir(outputDir, { recursive: true });

const entryPreview = await workbook.render({ sheetName: "Data Entry", range: "A1:L25", scale: 1, format: "png" });
await fs.writeFile(path.join(outputDir, "preview_data_entry.png"), new Uint8Array(await entryPreview.arrayBuffer()));
const invoicePreview = await workbook.render({ sheetName: "Invoice", range: "A1:H63", scale: 1, format: "png" });
await fs.writeFile(path.join(outputDir, "preview_invoice.png"), new Uint8Array(await invoicePreview.arrayBuffer()));
const ratesPreview = await workbook.render({ sheetName: "Rate Chart", range: "A1:M18", scale: 1, format: "png" });
await fs.writeFile(path.join(outputDir, "preview_rate_chart.png"), new Uint8Array(await ratesPreview.arrayBuffer()));
const wordsPreview = await workbook.render({ sheetName: "Words", range: "A1:E21", scale: 1, format: "png" });
await fs.writeFile(path.join(outputDir, "preview_words.png"), new Uint8Array(await wordsPreview.arrayBuffer()));
const calcPreview = await workbook.render({ sheetName: "Calc", range: "A1:B13", scale: 1, format: "png" });
await fs.writeFile(path.join(outputDir, "preview_calc.png"), new Uint8Array(await calcPreview.arrayBuffer()));

const invoiceCheck = await workbook.inspect({
  kind: "table",
  range: "Invoice!A1:H63",
  include: "values,formulas",
  tableMaxRows: 65,
  tableMaxCols: 8,
  maxChars: 10000,
});
console.log(invoiceCheck.ndjson);

const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 300 },
  summary: "final formula error scan",
  maxChars: 4000,
});
console.log(errors.ndjson);

const xlsx = await SpreadsheetFile.exportXlsx(workbook);
await xlsx.save(outputPath);
console.log(`Saved ${outputPath}`);
