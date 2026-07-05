const STORAGE_KEY = "courier-bill-app-v2";

const defaultState = {
  bill: {
    businessName: "GEETA SWARUP ENTERPRISES",
    courierBrand: "JETLINE COURIERS PVT LTD",
    businessAddress: "B GROUND FLOOR ADHARSHILA COMPLEX SOUTH GANDHI MAIDAN, PATNA",
    mobileNo: "8709210300",
    sacCode: "996812",
    billTo: "M/S BANDHAN BANK LTD",
    billAddress: "ASHOK RAJ PATH, PATNA",
    gstNo: "",
    branchCode: "PATN",
    shipperCode: "BANDAN (A)",
    invoiceNo: "2516/2025",
    invoiceDate: "2025-07-01",
    periodStart: "2025-07-01",
    periodEnd: "2025-07-31",
    fuelPct: 20,
    cgstPct: 9,
    sgstPct: 9,
  },
  rates: [
    { id: cryptoId(), client: "BANDAN (A)", destination: "PATNA", baseKg: 3, baseRate: 45, perKgRate: 15 },
    { id: cryptoId(), client: "BANDAN (A)", destination: "BIHAR", baseKg: 3, baseRate: 45, perKgRate: 15 },
    { id: cryptoId(), client: "BANDAN (A)", destination: "DHANBAD", baseKg: 3, baseRate: 60, perKgRate: 20 },
    { id: cryptoId(), client: "BANDAN (A)", destination: "DARBHANGA", baseKg: 3, baseRate: 50, perKgRate: 18 },
  ],
  shipments: [
    { id: cryptoId(), cno: "13595898", date: "2025-07-11", destination: "PATNA", type: "D", pcs: 1, weight: 0.1, manualAmount: "" },
    { id: cryptoId(), cno: "13595899", date: "2025-07-11", destination: "PATNA", type: "D", pcs: 1, weight: 0.1, manualAmount: "" },
    { id: cryptoId(), cno: "13595900", date: "2025-07-11", destination: "PATNA", type: "D", pcs: 1, weight: 0.1, manualAmount: "" },
    { id: cryptoId(), cno: "13603768", date: "2025-07-17", destination: "DHANBAD", type: "D", pcs: 1, weight: 0.1, manualAmount: "" },
    { id: cryptoId(), cno: "13635933", date: "2025-07-31", destination: "DARBHANGA", type: "D", pcs: 1, weight: 0.1, manualAmount: "" },
  ],
};

let state = loadState();
let deferredInstallPrompt = null;

const billFields = [
  "businessName",
  "courierBrand",
  "businessAddress",
  "mobileNo",
  "sacCode",
  "billTo",
  "billAddress",
  "gstNo",
  "branchCode",
  "shipperCode",
  "invoiceNo",
  "invoiceDate",
  "periodStart",
  "periodEnd",
  "fuelPct",
  "cgstPct",
  "sgstPct",
];

function cryptoId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function mergeImportedState(imported) {
  return {
    ...structuredClone(defaultState),
    ...imported,
    bill: { ...defaultState.bill, ...(imported.bill || {}) },
    rates: Array.isArray(imported.rates) ? imported.rates : structuredClone(defaultState.rates),
    shipments: Array.isArray(imported.shipments) ? imported.shipments : structuredClone(defaultState.shipments),
  };
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return structuredClone(defaultState);
  try {
    return mergeImportedState(JSON.parse(raw));
  } catch {
    return structuredClone(defaultState);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function money(value) {
  return `Rs ${Number(value || 0).toFixed(2)}`;
}

function plainMoney(value) {
  return Number(value || 0).toFixed(2);
}

function asNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalize(value) {
  return String(value || "").trim().toUpperCase();
}

function formatDate(value) {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function getRate(client, destination) {
  const targetClient = normalize(client);
  const targetDestination = normalize(destination);
  return state.rates.find(
    (rate) => normalize(rate.client) === targetClient && normalize(rate.destination) === targetDestination,
  );
}

function calculateShipment(shipment) {
  const manual = Number(shipment.manualAmount);
  if (Number.isFinite(manual) && String(shipment.manualAmount).trim() !== "") {
    return { amount: manual, status: "manual" };
  }

  const rate = getRate(state.bill.shipperCode, shipment.destination);
  if (!rate) return { amount: 0, status: "missing" };

  const weight = asNumber(shipment.weight);
  const pcs = asNumber(shipment.pcs, 1);
  const baseKg = asNumber(rate.baseKg);
  const baseRate = asNumber(rate.baseRate);
  const perKgRate = asNumber(rate.perKgRate);
  const extraWeight = Math.max(0, weight - baseKg);
  const amount = round2((baseRate + extraWeight * perKgRate) * pcs);
  return { amount, status: "ok" };
}

function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function totals() {
  const gross = round2(
    state.shipments.reduce((sum, shipment) => {
      if (!shipment.cno && !shipment.destination) return sum;
      return sum + calculateShipment(shipment).amount;
    }, 0),
  );
  const fuel = round2(gross * (asNumber(state.bill.fuelPct) / 100));
  const subtotal = round2(gross + fuel);
  const cgst = round2(subtotal * (asNumber(state.bill.cgstPct) / 100));
  const sgst = round2(subtotal * (asNumber(state.bill.sgstPct) / 100));
  const final = round2(subtotal + cgst + sgst);
  return { gross, fuel, subtotal, cgst, sgst, final };
}

function numberToWordsIndian(value) {
  const ones = ["", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE", "TEN", "ELEVEN", "TWELVE", "THIRTEEN", "FOURTEEN", "FIFTEEN", "SIXTEEN", "SEVENTEEN", "EIGHTEEN", "NINETEEN"];
  const tens = ["", "", "TWENTY", "THIRTY", "FORTY", "FIFTY", "SIXTY", "SEVENTY", "EIGHTY", "NINETY"];
  const twoDigits = (number) => {
    if (number < 20) return ones[number];
    return `${tens[Math.floor(number / 10)]} ${ones[number % 10]}`.trim();
  };
  const threeDigits = (number) => {
    const hundred = Math.floor(number / 100);
    const rest = number % 100;
    return `${hundred ? `${ones[hundred]} HUNDRED` : ""} ${rest ? twoDigits(rest) : ""}`.trim();
  };
  const convert = (number) => {
    if (number === 0) return "ZERO";
    const crore = Math.floor(number / 10000000);
    number %= 10000000;
    const lakh = Math.floor(number / 100000);
    number %= 100000;
    const thousand = Math.floor(number / 1000);
    number %= 1000;
    return [
      crore ? `${twoDigits(crore)} CRORE` : "",
      lakh ? `${twoDigits(lakh)} LAKH` : "",
      thousand ? `${twoDigits(thousand)} THOUSAND` : "",
      number ? threeDigits(number) : "",
    ].filter(Boolean).join(" ");
  };

  const rupees = Math.floor(Math.abs(value));
  const paise = Math.round((Math.abs(value) - rupees) * 100);
  const words = convert(rupees);
  if (paise > 0) return `${words} AND ${convert(paise)} PAISE`;
  return words;
}

function getShipperDestinations(shipperCode = state.bill.shipperCode) {
  const targetClient = normalize(shipperCode);
  return Array.from(
    new Set(
      state.rates
        .filter((rate) => normalize(rate.client) === targetClient)
        .map((rate) => rate.destination)
        .filter(Boolean),
    ),
  );
}

function countMissingRates() {
  return state.shipments.filter((shipment) => {
    if (!shipment.cno && !shipment.destination) return false;
    return calculateShipment(shipment).status === "missing";
  }).length;
}

function showToast(message) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    toast.hidden = true;
  }, 2800);
}

function nextInvoiceNo(current) {
  const match = String(current || "").match(/^(\d+)(\/\d+)?$/);
  if (!match) return current;
  const next = String(Number(match[1]) + 1);
  return match[2] ? `${next}${match[2]}` : next;
}

function nextPeriodDates(periodEnd) {
  const end = periodEnd ? new Date(`${periodEnd}T12:00:00`) : new Date();
  const start = new Date(end.getFullYear(), end.getMonth() + 1, 1);
  const lastDay = new Date(start.getFullYear(), start.getMonth() + 1, 0);
  const toIso = (date) => date.toISOString().slice(0, 10);
  return { periodStart: toIso(start), periodEnd: toIso(lastDay), invoiceDate: toIso(start) };
}

function bindBillForm() {
  billFields.forEach((field) => {
    const input = document.getElementById(field);
    if (!input) return;
    input.value = state.bill[field] ?? "";
    const persist = () => {
      state.bill[field] = input.value;
      saveState();
      if (field === "shipperCode") {
        renderShipments();
        syncQuickDestinationOptions();
      }
      renderAll();
    };
    input.addEventListener("input", persist);
    if (input.tagName === "SELECT") input.addEventListener("change", persist);
  });

  document.getElementById("billForm")?.addEventListener("submit", (event) => event.preventDefault());
}

function renderShipperOptions() {
  const select = document.getElementById("shipperCode");
  const clients = Array.from(new Set(state.rates.map((rate) => rate.client).filter(Boolean)));
  const current = state.bill.shipperCode;
  if (current && !clients.includes(current)) clients.unshift(current);
  select.innerHTML = clients.map((client) => `<option value="${escapeHtml(client)}">${escapeHtml(client)}</option>`).join("");
  select.value = current;

  const label = document.getElementById("rateClientLabel");
  if (label) label.textContent = current || "—";
  syncQuickDestinationOptions();
}

function syncQuickDestinationOptions() {
  const select = document.getElementById("quickDestination");
  if (!select) return;
  const destinations = getShipperDestinations();
  select.innerHTML = destinations.length
    ? destinations.map((d) => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join("")
    : `<option value="">Pehle rate add karo</option>`;
}

function syncQuickAddDefaults() {
  const dateInput = document.getElementById("quickDate");
  if (dateInput && !dateInput.value) {
    dateInput.value = state.bill.invoiceDate || new Date().toISOString().slice(0, 10);
  }
}

function renderRates() {
  renderShipperOptions();
  const list = document.getElementById("rateList");
  const count = document.getElementById("rateCount");
  if (count) count.textContent = `${state.rates.length} rate${state.rates.length === 1 ? "" : "s"}`;

  if (!state.rates.length) {
    list.innerHTML = `<div class="empty-state">Koi rate nahi hai. Upar Quick Add se pehla rate daalo.</div>`;
    return;
  }

  const rows = state.rates.map((rate, index) => `
    <tr data-id="${rate.id}">
      <td class="col-num">${index + 1}</td>
      <td><input class="cell-input" data-id="${rate.id}" data-field="client" data-kind="rate" value="${escapeHtml(rate.client ?? "")}" placeholder="Client" /></td>
      <td><input class="cell-input" data-id="${rate.id}" data-field="destination" data-kind="rate" value="${escapeHtml(rate.destination ?? "")}" placeholder="Destination" /></td>
      <td><input class="cell-input cell-num" data-id="${rate.id}" data-field="baseKg" data-kind="rate" type="number" inputmode="decimal" value="${escapeHtml(rate.baseKg ?? "")}" /></td>
      <td><input class="cell-input cell-num" data-id="${rate.id}" data-field="baseRate" data-kind="rate" type="number" inputmode="decimal" value="${escapeHtml(rate.baseRate ?? "")}" /></td>
      <td><input class="cell-input cell-num" data-id="${rate.id}" data-field="perKgRate" data-kind="rate" type="number" inputmode="decimal" value="${escapeHtml(rate.perKgRate ?? "")}" /></td>
      <td class="col-action">
        <button class="icon-btn delete" type="button" data-action="delete-rate" aria-label="Delete rate">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 7h12M9 7V5h6v2m-7 3v8m4-8v8m4-8v8M8 7l1 14h6l1-14" /></svg>
        </button>
      </td>
    </tr>
  `).join("");

  list.innerHTML = `
    <table class="entry-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Client</th>
          <th>Destination</th>
          <th>Base KG</th>
          <th>Base Rate</th>
          <th>Per KG</th>
          <th></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderShipments() {
  const list = document.getElementById("shipmentList");
  const count = document.getElementById("shipmentCount");
  if (count) count.textContent = `${state.shipments.length} row${state.shipments.length === 1 ? "" : "s"}`;

  if (!state.shipments.length) {
    list.innerHTML = `<div class="empty-state">Koi shipment nahi. Upar C/NO daalo aur <strong>Add Shipment</strong> dabao.</div>`;
    return;
  }

  const rows = state.shipments.map((shipment, index) => {
    const result = calculateShipment(shipment);
    const destOptions = getShipperDestinations();
    if (shipment.destination && !destOptions.includes(shipment.destination)) destOptions.unshift(shipment.destination);
    const destSelect = destOptions.length
      ? destOptions.map((d) => `<option value="${escapeHtml(d)}" ${d === shipment.destination ? "selected" : ""}>${escapeHtml(d)}</option>`).join("")
      : `<option value="">No rate</option>`;

    return `
      <tr data-id="${shipment.id}" class="shipment-card ${result.status === "missing" ? "row-error" : ""}">
        <td class="col-num">${index + 1}</td>
        <td><input class="cell-input" data-id="${shipment.id}" data-field="cno" data-kind="shipment" value="${escapeHtml(shipment.cno ?? "")}" placeholder="C/NO" inputmode="numeric" /></td>
        <td><input class="cell-input" data-id="${shipment.id}" data-field="date" data-kind="shipment" type="date" value="${escapeHtml(shipment.date ?? "")}" /></td>
        <td><select class="cell-select" data-id="${shipment.id}" data-field="destination" data-kind="shipment">${destSelect}</select></td>
        <td><input class="cell-input cell-sm" data-id="${shipment.id}" data-field="type" data-kind="shipment" value="${escapeHtml(shipment.type || "D")}" /></td>
        <td><input class="cell-input cell-num" data-id="${shipment.id}" data-field="pcs" data-kind="shipment" type="number" inputmode="numeric" value="${escapeHtml(shipment.pcs ?? 1)}" /></td>
        <td><input class="cell-input cell-num" data-id="${shipment.id}" data-field="weight" data-kind="shipment" type="number" inputmode="decimal" step="0.001" value="${escapeHtml(shipment.weight ?? "")}" /></td>
        <td class="col-amount">
          <span class="amount-pill ${result.status === "missing" ? "error" : ""}">
            ${result.status === "missing" ? "CHECK RATE" : money(result.amount)}
          </span>
        </td>
        <td class="col-action">
          <button class="icon-btn" type="button" data-action="duplicate-shipment" aria-label="Duplicate" title="Copy row">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 8V5a2 2 0 0 1 2-2h9v13h-3M6 21H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2" /></svg>
          </button>
          <button class="icon-btn delete" type="button" data-action="delete-shipment" aria-label="Delete">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 7h12M9 7V5h6v2m-7 3v8m4-8v8m4-8v8M8 7l1 14h6l1-14" /></svg>
          </button>
        </td>
      </tr>
    `;
  }).join("");

  list.innerHTML = `
    <table class="entry-table">
      <thead>
        <tr>
          <th>#</th>
          <th>C/NO</th>
          <th>Date</th>
          <th>Dest</th>
          <th>Type</th>
          <th>Pcs</th>
          <th>WT</th>
          <th>Amt</th>
          <th></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderSummary() {
  const total = totals();
  document.getElementById("summaryGross").textContent = money(total.gross);
  document.getElementById("summarySubtotal").textContent = money(total.subtotal);
  document.getElementById("summaryFinal").textContent = money(total.final);

  const missing = countMissingRates();
  const banner = document.getElementById("warningBanner");
  if (banner) {
    banner.hidden = missing === 0;
    banner.textContent = missing === 1
      ? "1 shipment ka rate missing hai. Rates tab mein check karo."
      : `${missing} shipments ka rate missing hai. Rates tab mein check karo.`;
  }
}

function renderInvoice() {
  const total = totals();
  const rows = state.shipments
    .filter((shipment) => shipment.cno || shipment.destination)
    .map((shipment, index) => {
      const result = calculateShipment(shipment);
      return `
        <tr>
          <td>${index + 1}</td>
          <td>${escapeHtml(shipment.cno)}</td>
          <td>${formatDate(shipment.date)}</td>
          <td>${escapeHtml(shipment.destination)}</td>
          <td>${escapeHtml(shipment.type || "D")}</td>
          <td>${escapeHtml(shipment.pcs || 1)}</td>
          <td>${asNumber(shipment.weight).toFixed(3)}</td>
          <td>${result.status === "missing" ? "CHECK RATE" : plainMoney(result.amount)}</td>
        </tr>
      `;
    }).join("");

  document.getElementById("invoicePaper").innerHTML = `
    <div class="invoice-header">
      <h2>${escapeHtml(state.bill.businessName)}</h2>
      <h3>${escapeHtml(state.bill.courierBrand)}</h3>
      <p>${escapeHtml(state.bill.businessAddress)}</p>
      <p>MOB NO : ${escapeHtml(state.bill.mobileNo)} &nbsp; SAC CODE : ${escapeHtml(state.bill.sacCode)}</p>
    </div>
    <div class="invoice-meta">
      <div>
        <div>${escapeHtml(state.bill.billTo)}</div>
        <div>${escapeHtml(state.bill.billAddress)}</div>
        <div>GST NO : ${escapeHtml(state.bill.gstNo)}</div>
        <div>PAGE: 1</div>
      </div>
      <div>
        <div>INVOICE DATE: ${formatDate(state.bill.invoiceDate)}</div>
        <div>BRANCH CODE : ${escapeHtml(state.bill.branchCode)}</div>
        <div>SHIPPER CODE: ${escapeHtml(state.bill.shipperCode)}</div>
        <div>INVOICE #: ${escapeHtml(state.bill.invoiceNo)}</div>
        <div>PERIOD : ${formatDate(state.bill.periodStart)} TO ${formatDate(state.bill.periodEnd)}</div>
      </div>
    </div>
    <table class="invoice-table">
      <thead>
        <tr>
          <th>S.NO</th>
          <th>C/NO</th>
          <th>DATE</th>
          <th>DEST</th>
          <th>TYPE</th>
          <th>PCS</th>
          <th>WT (KG)</th>
          <th>AMOUNT</th>
        </tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="8">No shipments added</td></tr>`}</tbody>
    </table>
    <div class="totals-wrap">
      <table class="totals-table">
        <tr><td>G TOTAL: RS</td><td>${plainMoney(total.gross)}</td></tr>
        <tr><td>Fuel charge @ ${plainMoney(state.bill.fuelPct)}%</td><td>${plainMoney(total.fuel)}</td></tr>
        <tr><td>SUB TOTAL</td><td>${plainMoney(total.subtotal)}</td></tr>
        <tr><td>CGST @ ${plainMoney(state.bill.cgstPct)}%</td><td>${plainMoney(total.cgst)}</td></tr>
        <tr><td>SGST @ ${plainMoney(state.bill.sgstPct)}%</td><td>${plainMoney(total.sgst)}</td></tr>
        <tr><td>BILL AMOUNT</td><td>${plainMoney(total.final)}</td></tr>
      </table>
    </div>
    <div class="amount-words">RUPEES: ${numberToWordsIndian(total.final)} ONLY</div>
    <div>E.&amp; O.E.</div>
    <div class="signature">FOR ${escapeHtml(state.bill.businessName)}</div>
  `;
}

function renderAll() {
  renderSummary();
  renderInvoice();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function addRate() {
  state.rates.push({ id: cryptoId(), client: state.bill.shipperCode || "", destination: "", baseKg: 3, baseRate: 0, perKgRate: 0 });
  saveState();
  renderRates();
  renderShipments();
  renderAll();
  focusLastRateField("destination");
}

function quickAddRate() {
  const destination = document.getElementById("quickRateDestination")?.value.trim().toUpperCase();
  const baseKg = document.getElementById("quickBaseKg")?.value;
  const baseRate = document.getElementById("quickBaseRate")?.value;
  const perKgRate = document.getElementById("quickPerKgRate")?.value;

  if (!destination) {
    document.getElementById("quickRateDestination")?.focus();
    showToast("Destination daalo");
    return;
  }
  if (String(baseRate ?? "").trim() === "") {
    document.getElementById("quickBaseRate")?.focus();
    showToast("Base rate daalo");
    return;
  }

  const exists = state.rates.some(
    (r) => normalize(r.client) === normalize(state.bill.shipperCode) && normalize(r.destination) === normalize(destination),
  );
  if (exists) {
    showToast(`${destination} ka rate pehle se hai — table mein edit karo`);
    return;
  }

  state.rates.push({
    id: cryptoId(),
    client: state.bill.shipperCode || "",
    destination,
    baseKg: asNumber(baseKg, 3),
    baseRate: asNumber(baseRate),
    perKgRate: asNumber(perKgRate),
  });
  saveState();
  document.getElementById("quickRateDestination").value = "";
  document.getElementById("quickBaseRate").value = "";
  document.getElementById("quickPerKgRate").value = "";
  renderRates();
  renderShipments();
  renderAll();
  showToast(`${destination} rate add ho gaya`);
  document.getElementById("quickRateDestination")?.focus();
}

function addShipment() {
  const destinations = getShipperDestinations();
  state.shipments.push({
    id: cryptoId(),
    cno: "",
    date: state.bill.invoiceDate || new Date().toISOString().slice(0, 10),
    destination: destinations[0] || "",
    type: "D",
    pcs: 1,
    weight: 0.1,
    manualAmount: "",
  });
  saveState();
  renderShipments();
  renderAll();
  focusLastShipmentField("cno");
}

function quickAddShipment() {
  const cno = document.getElementById("quickCno")?.value.trim();
  const date = document.getElementById("quickDate")?.value;
  const destination = document.getElementById("quickDestination")?.value;
  const weight = document.getElementById("quickWeight")?.value;
  const pcs = document.getElementById("quickPcs")?.value;

  if (!cno) {
    document.getElementById("quickCno")?.focus();
    showToast("C/NO daalo");
    return;
  }
  if (!destination) {
    showToast("Pehle Rates tab mein destination add karo");
    switchScreen("rates");
    return;
  }

  state.shipments.push({
    id: cryptoId(),
    cno,
    date: date || state.bill.invoiceDate || new Date().toISOString().slice(0, 10),
    destination,
    type: "D",
    pcs: asNumber(pcs, 1),
    weight: asNumber(weight, 0.1),
    manualAmount: "",
  });
  saveState();
  document.getElementById("quickCno").value = "";
  renderShipments();
  renderAll();
  showToast(`C/NO ${cno} add ho gaya`);
  document.getElementById("quickCno")?.focus();
}

function duplicateShipment(id) {
  const source = state.shipments.find((s) => s.id === id);
  if (!source) return;
  state.shipments.push({
    id: cryptoId(),
    cno: "",
    date: source.date,
    destination: source.destination,
    type: source.type || "D",
    pcs: source.pcs,
    weight: source.weight,
    manualAmount: "",
  });
  saveState();
  renderShipments();
  renderAll();
  focusLastShipmentField("cno");
}

function focusLastShipmentField(field) {
  requestAnimationFrame(() => {
    const rows = document.querySelectorAll("#shipmentList tbody tr");
    rows[rows.length - 1]?.querySelector(`[data-field="${field}"]`)?.focus();
  });
}

function focusLastRateField(field) {
  requestAnimationFrame(() => {
    const rows = document.querySelectorAll("#rateList tbody tr");
    rows[rows.length - 1]?.querySelector(`[data-field="${field}"]`)?.focus();
  });
}

function newBill() {
  if (!confirm("Shipments clear hongi. Invoice no. aur period agle mahine par shift honge. Rates safe rahenge. Continue?")) return;
  const nextPeriod = nextPeriodDates(state.bill.periodEnd);
  state.bill.invoiceNo = nextInvoiceNo(state.bill.invoiceNo);
  state.bill.periodStart = nextPeriod.periodStart;
  state.bill.periodEnd = nextPeriod.periodEnd;
  state.bill.invoiceDate = nextPeriod.invoiceDate;
  state.shipments = [];
  saveState();
  billFields.forEach((field) => {
    const input = document.getElementById(field);
    if (input) input.value = state.bill[field] ?? "";
  });
  renderShipments();
  renderAll();
  showToast("Nayi bill ready. Ab shipments add karo.");
}

function parseBulkShipments(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return [];

  const destinations = getShipperDestinations();
  const defaultDestination = destinations[0] || "";
  const defaultDate = state.bill.invoiceDate || new Date().toISOString().slice(0, 10);
  const rows = [];

  lines.forEach((line) => {
    const parts = line.includes("\t") ? line.split("\t") : line.split(",").map((part) => part.trim());
    const [cno = "", date = defaultDate, destination = defaultDestination, type = "D", pcs = "1", weight = "0.1", manualAmount = ""] = parts;
    if (!cno && !destination) return;
    rows.push({
      id: cryptoId(),
      cno,
      date: normalizeDateInput(date) || defaultDate,
      destination: destination || defaultDestination,
      type: type || "D",
      pcs: pcs || 1,
      weight: weight || 0.1,
      manualAmount,
    });
  });
  return rows;
}

function normalizeDateInput(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const slashMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const [, day, month, year] = slashMatch;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  const dashMatch = raw.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (dashMatch) {
    const [, day, month, year] = dashMatch;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  return raw;
}

function importBulkShipments() {
  const textarea = document.getElementById("bulkImportInput");
  const rows = parseBulkShipments(textarea?.value || "");
  if (!rows.length) {
    alert("Koi valid row nahi mili. Format: C/NO, Date, Destination, Type, PCS, Weight");
    return;
  }
  state.shipments.push(...rows);
  saveState();
  if (textarea) textarea.value = "";
  renderShipments();
  renderAll();
  showToast(`${rows.length} shipments add ho gaye.`);
}

function updateShipmentRow(shipment) {
  const row = document.querySelector(`#shipmentList tr[data-id="${shipment.id}"]`);
  if (!row) return;
  const result = calculateShipment(shipment);
  const pill = row.querySelector(".amount-pill");
  if (pill) {
    pill.classList.toggle("error", result.status === "missing");
    pill.textContent = result.status === "missing" ? "CHECK RATE" : money(result.amount);
  }
  row.classList.toggle("row-error", result.status === "missing");
}

function updateAllShipmentRows() {
  state.shipments.forEach(updateShipmentRow);
}

function handleLiveInput(event) {
  const target = event.target;
  const id = target.dataset.id;
  const field = target.dataset.field;
  const kind = target.dataset.kind;
  if (!id || !field || !kind) return;

  const collection = kind === "rate" ? state.rates : state.shipments;
  const item = collection.find((entry) => entry.id === id);
  if (!item) return;

  item[field] = target.value;
  saveState();
  if (kind === "rate") {
    if (field === "client" || field === "destination") renderShipperOptions();
    updateAllShipmentRows();
  } else {
    updateShipmentRow(item);
  }
  renderAll();
}

function handleCommittedChange(event) {
  handleLiveInput(event);
  const kind = event.target.dataset.kind;
  const field = event.target.dataset.field;
  if (kind === "rate" && (field === "client" || field === "destination")) {
    renderRates();
    renderShipments();
    renderAll();
  }
}

function handleDelete(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const card = button.closest("[data-id]");
  const id = card?.dataset.id;
  if (!id) return;

  if (button.dataset.action === "delete-rate") {
    if (!confirm("Ye rate delete karna hai?")) return;
    state.rates = state.rates.filter((rate) => rate.id !== id);
    saveState();
    renderRates();
    renderShipments();
  }
  if (button.dataset.action === "delete-shipment") {
    state.shipments = state.shipments.filter((shipment) => shipment.id !== id);
    saveState();
    renderShipments();
  }
  if (button.dataset.action === "duplicate-shipment") {
    duplicateShipment(id);
    return;
  }
  renderAll();
}

function printInvoice() {
  const missing = countMissingRates();
  if (missing > 0) {
    alert(`${missing} shipment(s) ka rate missing hai. Pehle Rates tab mein fix karo, phir print karo.`);
    switchScreen("rates");
    return;
  }
  if (!state.shipments.some((shipment) => shipment.cno || shipment.destination)) {
    alert("Print karne ke liye kam se kam ek shipment add karo.");
    switchScreen("entry");
    return;
  }
  window.print();
}

function switchScreen(target) {
  document.querySelectorAll(".screen").forEach((screen) => {
    screen.classList.toggle("active", screen.dataset.screen === target);
  });
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.target === target);
  });
  if (target === "invoice") renderInvoice();
}

function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `courier-bill-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(String(reader.result));
      if (!imported || typeof imported !== "object") throw new Error("invalid");
      if (!confirm("Current data backup file se replace ho jayegi. Continue?")) return;
      state = mergeImportedState(imported);
      saveState();
      init(false);
      showToast("Backup restore ho gaya.");
    } catch {
      alert("Backup file read nahi ho paayi. Sahi JSON file choose karo.");
    } finally {
      const input = document.getElementById("importInput");
      if (input) input.value = "";
    }
  };
  reader.readAsText(file);
}

function setupInstallPrompt() {
  const installButton = document.getElementById("installButton");
  if (!installButton) return;

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    installButton.hidden = false;
  });

  installButton.addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    installButton.hidden = true;
  });
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

function bindEntryTables() {
  ["rateList", "shipmentList"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("input", handleLiveInput);
    el.addEventListener("change", handleCommittedChange);
    el.addEventListener("click", handleDelete);
  });
}

function bindQuickAdd() {
  document.getElementById("quickAddShipmentButton")?.addEventListener("click", quickAddShipment);
  document.getElementById("quickAddRateButton")?.addEventListener("click", quickAddRate);

  document.getElementById("quickCno")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      quickAddShipment();
    }
  });

  document.getElementById("quickRateDestination")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      quickAddRate();
    }
  });

  document.getElementById("shipmentQuickAdd")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.target.tagName !== "TEXTAREA") {
      event.preventDefault();
      quickAddShipment();
    }
  });

  document.getElementById("rateQuickAdd")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      quickAddRate();
    }
  });
}

function init(bind = true) {
  renderShipperOptions();
  billFields.forEach((field) => {
    const input = document.getElementById(field);
    if (input) input.value = state.bill[field] ?? "";
  });
  syncQuickAddDefaults();
  renderRates();
  renderShipments();
  renderAll();

  if (!bind) return;
  bindBillForm();
  bindEntryTables();
  bindQuickAdd();
  document.getElementById("addRateButton").addEventListener("click", addRate);
  document.getElementById("addShipmentButton").addEventListener("click", addShipment);
  document.getElementById("newBillButton").addEventListener("click", newBill);
  document.getElementById("printButton").addEventListener("click", printInvoice);
  document.getElementById("exportButton").addEventListener("click", () => {
    exportData();
    showToast("Backup download ho gaya.");
  });
  document.getElementById("bulkImportButton")?.addEventListener("click", importBulkShipments);
  document.getElementById("importInput").addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (file) importData(file);
  });
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => switchScreen(button.dataset.target));
  });
  setupInstallPrompt();
  registerServiceWorker();

  if (!state.shipments.length) {
    document.getElementById("quickCno")?.focus();
  }
}

init();
