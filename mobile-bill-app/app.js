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
    logoSrc: "assets/logo.png",
    signatureSrc: "",
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

// Do not load private drafts until the server confirms the operator's session.
let state = null;
let workspaceEpoch = 0;
let invoiceSaving = false;
let historicalRecord = null;
let localDraftConflict = false;
const workspaceTemplate = document.querySelector('.app-shell')?.innerHTML;
const reviewTemplate = document.getElementById('pdfReviewModal')?.innerHTML;
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
  if (!window.CourierAuth.isAuthenticated()) throw new Error('Sign in to open private drafts.');
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const fresh = structuredClone(defaultState);
    fresh.bill.logoSrc = "assets/logo.png";
    return fresh;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed?.bill || typeof parsed.bill !== 'object' || !Array.isArray(parsed.rates) || !Array.isArray(parsed.shipments)) throw new Error('Invalid stored draft');
    const loaded = mergeImportedState(parsed);
    if (loaded.bill.logoSrc === "" || loaded.bill.logoSrc === undefined) {
      loaded.bill.logoSrc = "assets/logo.png";
    }
    return loaded;
  } catch {
    throw new Error('The stored draft cannot be read. It has not been changed. Download it for recovery.');
  }
}

function saveState(markDirty = true) {
  if (!state) return false;
  if (localDraftConflict) { setInvoiceSaveState('Failed to save', 'Another tab changed the draft. This tab was archived; reload before continuing.'); return false; }
  if (markDirty) {
    historicalRecord = null;
    state.persistence ||= {};
    state.persistence.dirty = true;
    setInvoiceSaveState('Unsaved', 'Changes are stored on this device until a save is confirmed.');
  }
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); return true; }
  catch { setInvoiceSaveState('Failed to save', 'Device storage is full. Keep this tab open and download a backup before continuing.'); return false; }
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
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
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
    <tr data-id="${escapeHtml(rate.id)}">
      <td class="col-num">${index + 1}</td>
      <td><input class="cell-input" data-id="${escapeHtml(rate.id)}" data-field="client" data-kind="rate" value="${escapeHtml(rate.client ?? "")}" placeholder="Client" /></td>
      <td><input class="cell-input" data-id="${escapeHtml(rate.id)}" data-field="destination" data-kind="rate" value="${escapeHtml(rate.destination ?? "")}" placeholder="Destination" /></td>
      <td><input class="cell-input cell-num" data-id="${escapeHtml(rate.id)}" data-field="baseKg" data-kind="rate" type="number" inputmode="decimal" value="${escapeHtml(rate.baseKg ?? "")}" /></td>
      <td><input class="cell-input cell-num" data-id="${escapeHtml(rate.id)}" data-field="baseRate" data-kind="rate" type="number" inputmode="decimal" value="${escapeHtml(rate.baseRate ?? "")}" /></td>
      <td><input class="cell-input cell-num" data-id="${escapeHtml(rate.id)}" data-field="perKgRate" data-kind="rate" type="number" inputmode="decimal" value="${escapeHtml(rate.perKgRate ?? "")}" /></td>
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
      <tr data-id="${escapeHtml(shipment.id)}" class="shipment-card ${result.status === "missing" ? "row-error" : ""}">
        <td class="col-num">${index + 1}</td>
        <td><input class="cell-input" data-id="${escapeHtml(shipment.id)}" data-field="cno" data-kind="shipment" value="${escapeHtml(shipment.cno ?? "")}" placeholder="C/NO" inputmode="numeric" /></td>
        <td><input class="cell-input" data-id="${escapeHtml(shipment.id)}" data-field="date" data-kind="shipment" type="date" value="${escapeHtml(shipment.date ?? "")}" /></td>
        <td><select class="cell-select" data-id="${escapeHtml(shipment.id)}" data-field="destination" data-kind="shipment">${destSelect}</select></td>
        <td><input class="cell-input cell-sm" data-id="${escapeHtml(shipment.id)}" data-field="type" data-kind="shipment" value="${escapeHtml(shipment.type || "D")}" /></td>
        <td><input class="cell-input cell-num" data-id="${escapeHtml(shipment.id)}" data-field="pcs" data-kind="shipment" type="number" inputmode="numeric" value="${escapeHtml(shipment.pcs ?? 1)}" /></td>
        <td><input class="cell-input cell-num" data-id="${escapeHtml(shipment.id)}" data-field="weight" data-kind="shipment" type="number" inputmode="decimal" step="0.001" value="${escapeHtml(shipment.weight ?? "")}" /></td>
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
  const total = historicalRecord?.snapshot?.totals || totals();
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

function renderInvoice(record = historicalRecord) {
  const total = record?.snapshot?.totals || totals();
  const rows = state.shipments
    .filter((shipment) => shipment.cno || shipment.destination)
    .map((shipment, index) => {
      const result = record?.shipments?.[index] ? { amount: record.shipments[index].amount, status: 'ok' } : calculateShipment(shipment);
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

  const logoHtml = (state.bill.logoSrc && state.bill.logoSrc !== "none")
    ? `<img src="${escapeHtml(safeImageSource(state.bill.logoSrc))}" class="invoice-logo" alt="Logo" />`
    : "";

  document.getElementById("invoicePaper").innerHTML = `
    <div class="invoice-header ${state.bill.logoSrc && state.bill.logoSrc !== 'none' ? 'has-logo' : ''}">
      ${logoHtml}
      <div class="invoice-header-text">
        <h2>${escapeHtml(state.bill.businessName)}</h2>
        <h3>${escapeHtml(state.bill.courierBrand)}</h3>
        <p>${escapeHtml(state.bill.businessAddress)}</p>
        <p>MOB NO : ${escapeHtml(state.bill.mobileNo)} &nbsp; SAC CODE : ${escapeHtml(state.bill.sacCode)}</p>
      </div>
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
    <div class="invoice-bottom-row">
      <div class="e-oe">E.&amp; O.E.</div>
      <div class="signature-block">
        <div class="signature-for">FOR ${escapeHtml(state.bill.businessName)}</div>
        <div class="signature-image-wrap">
          ${state.bill.signatureSrc
      ? `<img src="${escapeHtml(safeImageSource(state.bill.signatureSrc))}" class="invoice-signature-img" alt="Signature" />`
      : `<div class="signature-placeholder"></div>`}
        </div>
        <div class="signature-title">PROPRIETOR / AUTHORISED SIGNATORY</div>
      </div>
    </div>
  `;
}

function renderAll() {
  renderSummary();
  renderInvoice();
}

function safeImageSource(value) {
  return typeof value === 'string' && (value === 'assets/logo.png' || /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(value)) ? value : '';
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
  if (!state || invoiceSaving) return;
  if (!confirm("Shipments clear hongi. Invoice no. aur period agle mahine par shift honge. Rates safe rahenge. Continue?")) return;
  if (!archiveCurrentDraft()) return;
  const previous = structuredClone(state);
  const nextPeriod = nextPeriodDates(state.bill.periodEnd);
  state.bill.invoiceNo = nextInvoiceNo(state.bill.invoiceNo);
  state.bill.periodStart = nextPeriod.periodStart;
  state.bill.periodEnd = nextPeriod.periodEnd;
  state.bill.invoiceDate = nextPeriod.invoiceDate;
  state.shipments = [];
  delete state.persistence;
  delete state.correctionOf;
  delete state.correctionReason;
  delete state.invoiceMetadata;
  if (!saveState()) { state = previous; return; }
  document.getElementById('invoiceDueDate').value = '';
  document.getElementById('invoiceNotes').value = '';
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
  const row = Array.from(document.querySelectorAll('#shipmentList tr[data-id]'))
    .find((entry) => entry.dataset.id === String(shipment.id));
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

async function printInvoice() {
  return persistInvoiceToBackend('GENERATED', true);
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
    if (!state || !window.CourierAuth.isAuthenticated()) return;
    try {
      const imported = JSON.parse(String(reader.result));
      if (!imported?.bill || typeof imported.bill !== 'object' || !Array.isArray(imported.rates) || !Array.isArray(imported.shipments)) throw new Error("invalid");
      if (!confirm("Current data backup file se replace ho jayegi. Continue?")) return;
      if (!archiveCurrentDraft()) return;
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
    navigator.serviceWorker.register("sw.js").catch(() => { });
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
  if (!state || !window.CourierAuth.isAuthenticated()) return;
  renderShipperOptions();
  billFields.forEach((field) => {
    const input = document.getElementById(field);
    if (input) input.value = state.bill[field] ?? "";
  });
  syncQuickAddDefaults();
  renderRates();
  renderShipments();
  renderAll();
  updateImageUploadsUI();
  renderDraftArchives();
  document.getElementById('invoiceDueDate').value = state.invoiceMetadata?.dueDate || '';
  document.getElementById('invoiceNotes').value = state.invoiceMetadata?.notes || '';
  setInvoiceSaveState('Unsaved', state.persistence?.pending ? 'An earlier save has an unknown outcome. Retry it to confirm persistence.' : 'Save a draft or finalize before printing.');

  if (!bind) return;
  bindBillForm();
  bindEntryTables();
  bindQuickAdd();

  // Image uploads handling
  const logoUpload = document.getElementById("logoUpload");
  const signatureUpload = document.getElementById("signatureUpload");
  const removeLogoBtn = document.getElementById("removeLogo");
  const removeSignatureBtn = document.getElementById("removeSignature");

  const handleImageUpload = (file, callback) => {
    const epoch = workspaceEpoch;
    const reader = new FileReader();
    reader.onload = (e) => { if (state && epoch === workspaceEpoch && window.CourierAuth.isAuthenticated()) callback(e.target.result); };
    reader.readAsDataURL(file);
  };

  logoUpload?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (file) {
      handleImageUpload(file, (base64) => {
        state.bill.logoSrc = base64;
        saveState();
        updateImageUploadsUI();
        renderAll();
      });
    }
  });

  signatureUpload?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (file) {
      handleImageUpload(file, (base64) => {
        state.bill.signatureSrc = base64;
        saveState();
        updateImageUploadsUI();
        renderAll();
      });
    }
  });

  removeLogoBtn?.addEventListener("click", () => {
    state.bill.logoSrc = "none";
    if (logoUpload) logoUpload.value = "";
    saveState();
    updateImageUploadsUI();
    renderAll();
  });

  removeSignatureBtn?.addEventListener("click", () => {
    state.bill.signatureSrc = "";
    if (signatureUpload) signatureUpload.value = "";
    saveState();
    updateImageUploadsUI();
    renderAll();
  });

  document.getElementById("addRateButton").addEventListener("click", addRate);
  document.getElementById("addShipmentButton").addEventListener("click", addShipment);
  document.getElementById("newBillButton").addEventListener("click", newBill);
  document.getElementById("printButton").addEventListener("click", printInvoice);
  document.getElementById('saveDraftButton').addEventListener('click', () => persistInvoiceToBackend('DRAFT'));
  document.getElementById('retrySaveButton').addEventListener('click', () => persistInvoiceToBackend(state?.persistence?.pending?.payload.status || 'DRAFT'));
  document.getElementById('restoreArchiveButton').addEventListener('click', restoreLocalArchive);
  for (const [id, key] of [['invoiceDueDate', 'dueDate'], ['invoiceNotes', 'notes']]) {
    document.getElementById(id).addEventListener('input', (event) => {
      state.invoiceMetadata ||= {}; state.invoiceMetadata[key] = event.target.value; saveState();
    });
  }
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
  setupAiPdfParser();
  setupHistoryTab();

  if (!state.shipments.length) {
    document.getElementById("quickCno")?.focus();
  }
}

function updateImageUploadsUI() {
  const logoPreview = document.getElementById("logoPreview");
  const removeLogoBtn = document.getElementById("removeLogo");
  const logoUpload = document.getElementById("logoUpload");

  const hasLogo = state.bill.logoSrc && state.bill.logoSrc !== "none";
  if (logoPreview) {
    logoPreview.src = hasLogo ? safeImageSource(state.bill.logoSrc) : "";
    logoPreview.style.display = hasLogo ? "block" : "none";
  }
  if (removeLogoBtn) {
    removeLogoBtn.style.display = hasLogo ? "inline-flex" : "none";
  }
  if (!hasLogo && logoUpload) {
    logoUpload.value = "";
  }

  const signaturePreview = document.getElementById("signaturePreview");
  const removeSignatureBtn = document.getElementById("removeSignature");
  const signatureUpload = document.getElementById("signatureUpload");

  const hasSig = !!state.bill.signatureSrc;
  if (signaturePreview) {
    signaturePreview.src = safeImageSource(state.bill.signatureSrc);
    signaturePreview.style.display = hasSig ? "block" : "none";
  }
  if (removeSignatureBtn) {
    removeSignatureBtn.style.display = hasSig ? "inline-flex" : "none";
  }
  if (!hasSig && signatureUpload) {
    signatureUpload.value = "";
  }
}

/* ==========================================================================
   Backend API Integration & AI PDF Parser Handlers
   ========================================================================== */

const API_BASE = (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")
  ? `${window.location.protocol}//${window.location.hostname}:5000/api`
  : "/api";

function setupAiPdfParser() {
  const triggerBtn = document.getElementById("triggerPdfUploadButton");
  const fileInput = document.getElementById("pdfRateUpload");
  const fileNameDisplay = document.getElementById("pdfFileNameDisplay");
  const parseBtn = document.getElementById("parsePdfButton");
  const spinner = document.getElementById("aiLoadingSpinner");

  triggerBtn?.addEventListener("click", () => fileInput?.click());

  fileInput?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (file) {
      if (fileNameDisplay) fileNameDisplay.textContent = file.name;
      if (parseBtn) parseBtn.disabled = false;
    } else {
      if (fileNameDisplay) fileNameDisplay.textContent = "No file chosen";
      if (parseBtn) parseBtn.disabled = true;
    }
  });

  parseBtn?.addEventListener("click", async () => {
    const file = fileInput?.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("pdf", file);

    if (spinner) spinner.hidden = false;
    if (parseBtn) parseBtn.disabled = true;

    try {
      const response = await window.CourierAuth.apiFetch(`${API_BASE}/rates/parse-pdf`, {
        method: "POST",
        body: formData
      });
      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || "Failed to parse PDF rate card");
      }

      openReviewModal(result.data);
      showToast("PDF parsed successfully by Gemini AI!");
    } catch (error) {
      console.error("AI PDF Parse Error:", error);
      showToast(`AI Parsing Error: ${error.message}`);
    } finally {
      if (spinner) spinner.hidden = true;
      if (parseBtn) parseBtn.disabled = false;
    }
  });

  document.getElementById("closeReviewModal")?.addEventListener("click", closeReviewModal);
  document.getElementById("cancelReviewModal")?.addEventListener("click", closeReviewModal);
  document.getElementById("addReviewRowButton")?.addEventListener("click", addReviewRow);
  document.getElementById("reviewRatesTableBody")?.addEventListener("click", (event) => {
    event.target.closest('button[data-action="delete-review"]')?.closest('tr')?.remove();
  });
  document.getElementById("saveReviewedRatesButton")?.addEventListener("click", saveReviewedRates);

  // Close modal when clicking the dark backdrop (outside the card)
  document.getElementById("pdfReviewModal")?.addEventListener("click", (e) => {
    if (e.target.id === "pdfReviewModal") closeReviewModal();
  });
}

function openReviewModal(data) {
  if (!state || !window.CourierAuth.isAuthenticated()) return;
  const modal = document.getElementById("pdfReviewModal");
  if (!modal) return;

  document.getElementById("reviewClientName").value = data.clientInfo?.clientName || state.bill.shipperCode || "";
  document.getElementById("reviewQuotationDate").value = data.clientInfo?.quotationDate || "";
  document.getElementById("reviewClientAddress").value = data.clientInfo?.address || "";
  document.getElementById("reviewMinWeightKg").value = data.globalRules?.minWeightKg ?? "";
  document.getElementById("reviewFuelSurchargePct").value = data.globalRules?.fuelSurchargePct ?? "";

  renderReviewModalTable(data.rates || []);

  // Show modal — clear all three hiding mechanisms
  modal.hidden = false;
  modal.classList.remove("hidden");
  modal.style.display = "";
}

function closeReviewModal() {
  const modal = document.getElementById("pdfReviewModal");
  if (!modal) return;
  modal.hidden = true;
  modal.classList.add("hidden");
  modal.style.display = "none";
}

function renderReviewModalTable(rates) {
  const tbody = document.getElementById("reviewRatesTableBody");
  if (!tbody) return;

  tbody.innerHTML = rates.map((r, idx) => `
    <tr data-idx="${idx}">
      <td><input class="review-target-name" value="${escapeHtml(r.targetName)}" placeholder="e.g. patna, bihar" /></td>
      <td>
        <select class="review-target-type">
          <option value="CITY" ${r.targetType === "CITY" ? "selected" : ""}>CITY</option>
          <option value="STATE" ${r.targetType === "STATE" ? "selected" : ""}>STATE</option>
          <option value="CUSTOM_ZONE" ${r.targetType === "CUSTOM_ZONE" ? "selected" : ""}>CUSTOM_ZONE</option>
          <option value="REGION" ${r.targetType === "REGION" ? "selected" : ""}>REGION</option>
          <option value="DEFAULT" ${r.targetType === "DEFAULT" ? "selected" : ""}>DEFAULT</option>
        </select>
      </td>
      <td><input type="number" class="review-base-kg" value="${escapeHtml(r.baseKg ?? 1)}" step="0.1" /></td>
      <td><input type="number" class="review-per-kg" value="${escapeHtml(r.perKgRate ?? 0)}" step="0.1" /></td>
      <td>
        <button type="button" class="icon-btn delete" data-action="delete-review">&times;</button>
      </td>
    </tr>
  `).join("");
}

function addReviewRow() {
  const tbody = document.getElementById("reviewRatesTableBody");
  if (!tbody) return;
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td><input class="review-target-name" placeholder="Target Name" /></td>
    <td>
      <select class="review-target-type">
        <option value="CITY">CITY</option>
        <option value="STATE">STATE</option>
        <option value="CUSTOM_ZONE">CUSTOM_ZONE</option>
        <option value="REGION">REGION</option>
        <option value="DEFAULT">DEFAULT</option>
      </select>
    </td>
    <td><input type="number" class="review-base-kg" value="1" step="0.1" /></td>
    <td><input type="number" class="review-per-kg" value="0" step="0.1" /></td>
    <td>
      <button type="button" class="icon-btn delete" data-action="delete-review">&times;</button>
    </td>
  `;
  tbody.appendChild(tr);
}

async function saveReviewedRates() {
  const shipperCode = document.getElementById("reviewClientName").value.trim().toUpperCase() || state.bill.shipperCode || "DEFAULT";
  const rows = document.querySelectorAll("#reviewRatesTableBody tr");

  const ratesToSave = [];
  rows.forEach((tr) => {
    const targetName = tr.querySelector(".review-target-name")?.value.trim().toLowerCase();
    const targetType = tr.querySelector(".review-target-type")?.value;
    const baseKg = Number(tr.querySelector(".review-base-kg")?.value || 1);
    const perKgRate = Number(tr.querySelector(".review-per-kg")?.value || 0);

    if (targetName && !isNaN(perKgRate)) {
      ratesToSave.push({ shipperCode, targetName, targetType, baseKg, perKgRate });
    }
  });

  if (!ratesToSave.length) {
    showToast("Kam se kam ek valid rate row add karo");
    return;
  }

  let savedCount = 0;
  for (const r of ratesToSave) {
    try {
      const res = await window.CourierAuth.apiFetch(`${API_BASE}/rates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(r)
      });
      if (res.ok) savedCount++;
    } catch (err) {
      console.warn("Backend rate save error (using local storage fallback):", err);
    }
    if (!state || !window.CourierAuth.isAuthenticated()) return;

    const existingIdx = state.rates.findIndex(
      (ex) => normalize(ex.client) === normalize(r.shipperCode) && normalize(ex.destination) === normalize(r.targetName)
    );
    if (existingIdx >= 0) {
      state.rates[existingIdx] = {
        ...state.rates[existingIdx],
        baseKg: r.baseKg,
        perKgRate: r.perKgRate,
        baseRate: r.perKgRate * r.baseKg
      };
    } else {
      state.rates.push({
        id: cryptoId(),
        client: r.shipperCode,
        destination: r.targetName.toUpperCase(),
        baseKg: r.baseKg,
        baseRate: r.perKgRate * r.baseKg,
        perKgRate: r.perKgRate
      });
    }
  }

  saveState();
  renderRates();
  renderShipments();
  renderAll();
  closeReviewModal();
  showToast(`${savedCount || ratesToSave.length} rates saved successfully!`);
}

function setupHistoryTab() {
  document.getElementById('historyInvoiceList')?.addEventListener('click', handleHistoryAction);
  document.getElementById("executeSearchButton")?.addEventListener("click", fetchPastInvoices);
  document.getElementById("refreshInvoicesButton")?.addEventListener("click", fetchPastInvoices);
  document.getElementById("clearSearchButton")?.addEventListener("click", () => {
    document.getElementById("historySearchInput").value = "";
    document.getElementById("historyStartDate").value = "";
    document.getElementById("historyEndDate").value = "";
    fetchPastInvoices();
  });
}

async function fetchPastInvoices() {
  const listEl = document.getElementById("historyInvoiceList");
  if (!listEl) return;

  listEl.innerHTML = `<div class="ai-loading"><div class="spinner"></div> Searching invoices from MongoDB Atlas...</div>`;

  const queryTerm = document.getElementById("historySearchInput")?.value.trim() || "";
  const startDate = document.getElementById("historyStartDate")?.value || "";
  const endDate = document.getElementById("historyEndDate")?.value || "";

  const params = new URLSearchParams();
  if (queryTerm) {
    params.append("q", queryTerm);
  }
  if (startDate) params.append("startDate", startDate);
  if (endDate) params.append("endDate", endDate);

  try {
    const res = await window.CourierAuth.apiFetch(`${API_BASE}/invoices/search?${params.toString()}`);
    if (!res.ok) throw new Error("Failed to fetch past invoices");
    const json = await res.json();
    const invoices = json.data || [];

    if (!invoices.length) {
      listEl.innerHTML = `<div class="empty-state">Koi past invoice nahi mili.</div>`;
      return;
    }

    listEl.innerHTML = invoices.map((inv) => `
      <div class="history-card">
        <div class="history-card-info">
          <h4>Invoice #${escapeHtml(inv.invoiceNumber)}</h4>
          <p>Client: <strong>${escapeHtml(inv.clientName || inv.shipperCode)}</strong> (${escapeHtml(inv.shipperCode)})</p>
          <p>Date: ${formatDate(inv.invoiceDate ? inv.invoiceDate.slice(0, 10) : "")} | ${inv.shipments?.length || 0} shipments</p>
        </div>
        <div class="history-card-amount">
          <div class="history-amount-text">${money(inv.totalAmount)}</div>
          <span class="badge-status ${escapeHtml((inv.status || "generated").toLowerCase())}">${escapeHtml(inv.status || "GENERATED")}</span>
          <div class="history-actions" data-invoice-id="${escapeHtml(inv._id)}">
            <button type="button" data-history="open">Open</button>
            <button type="button" data-history="download">Download record</button>
            <button type="button" data-history="correct">Create correction</button>
            ${inv.schemaVersion === 2 && inv.status === 'GENERATED' ? '<button type="button" data-history="PAID">Mark paid</button>' : ''}
            ${inv.schemaVersion === 2 && inv.status !== 'CANCELLED' ? '<button type="button" data-history="CANCELLED">Cancel</button>' : ''}
          </div>
        </div>
      </div>
    `).join("");
  } catch (err) {
    console.error("Fetch past invoices error:", err);
    listEl.innerHTML = `<div class="empty-state">Unable to load past invoices. Offline mode active.</div>`;
  }
}

function setInvoiceSaveState(label, message) {
  const badge = document.getElementById('invoiceSaveState');
  if (badge) badge.textContent = label;
  const detail = document.getElementById('invoiceSaveMessage');
  if (detail) detail.textContent = message;
  const retry = document.getElementById('retrySaveButton');
  if (retry) retry.hidden = !state?.persistence?.pending || invoiceSaving;
}
function invoicePayload(status) { return window.InvoicePersistence.payload(state, status, calculateShipment, totals); }
async function invoiceHash(payload) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(window.InvoicePersistence.content(payload)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
function setInvoiceBusy(busy) {
  invoiceSaving = busy;
  const main = document.querySelector('.app-shell main');
  if (main) main.inert = busy;
  const nav = document.querySelector('.bottom-nav');
  if (nav) nav.inert = busy;
  for (const id of ['printButton', 'saveDraftButton', 'retrySaveButton', 'newBillButton']) {
    const button = document.getElementById(id);
    if (button) button.disabled = busy;
  }
}
function finalPrint(record) {
  if (!state || !window.CourierAuth.isAuthenticated()) return;
  renderInvoice(record);
  document.body.classList.add('final-print');
  try { window.print(); }
  catch { showToast('Invoice is saved, but the print dialog could not open. Use Print to try again.'); }
  finally { document.body.classList.remove('final-print'); }
}
async function persistInvoiceToBackend(status = 'DRAFT', printAfter = false) {
  if (invoiceSaving || !state || !window.CourierAuth.isAuthenticated()) return false;
  if (localDraftConflict) { setInvoiceSaveState('Failed to save', 'Another tab changed the draft. Reload or restore its archive before saving.'); return false; }
  const current = state;
  const epoch = workspaceEpoch;
  let timeout;
  setInvoiceBusy(true);
  try {
    let payload;
    let invalidCurrent = false;
    try { payload = invoicePayload(status); } catch (error) {
      if (!current.persistence?.pending) throw error;
      payload = current.persistence.pending.payload; invalidCurrent = true;
    }
    const contentHash = invalidCurrent ? null : await invoiceHash(payload);
    if (epoch !== workspaceEpoch || state !== current || !window.CourierAuth.isAuthenticated()) return false;
    const meta = current.persistence ||= {};
    const controller = new AbortController();
    timeout = setTimeout(() => controller.abort(), 15000);
    if (!meta.pending && meta.confirmed?.invoiceNumber === payload.invoiceNumber && ['GENERATED', 'PAID'].includes(meta.confirmed.status)) {
      if (meta.confirmed.contentHash !== contentHash) throw new Error('This invoice is finalized. Use New Bill or create a correction; its history will not be overwritten.');
      setInvoiceSaveState('Saving', 'Confirming the saved invoice before final printing…');
      const response = await window.CourierAuth.apiFetch(`${API_BASE}/invoices/${meta.confirmed.id}`, { signal: controller.signal });
      const result = await response.json();
      if (!result.success || result.data.revision !== meta.confirmed.revision || !['GENERATED', 'PAID'].includes(result.data.status)) throw new Error('Saved invoice changed or was cancelled. Reload it from History.');
      if (state !== current || epoch !== workspaceEpoch) return false;
      setInvoiceSaveState('Saved', 'Finalized invoice confirmed. Totals are recorded, not independently verified.');
      if (printAfter) finalPrint(result.data);
      return true;
    }
    if (!meta.pending) {
      const revision = meta.confirmed?.invoiceNumber === payload.invoiceNumber ? meta.confirmed.revision : 0;
      meta.pending = { payload: { ...payload, requestId: crypto.randomUUID(), expectedVersion: revision }, contentHash };
      if (!saveState(false)) { delete meta.pending; throw new Error('Cannot safely retain the retry request. Free device storage or download a backup.'); }
    }
    const pending = meta.pending;
    setInvoiceSaveState('Saving', `Confirming ${pending.payload.status.toLowerCase()} invoice persistence…`);
    const response = await window.CourierAuth.apiFetch(`${API_BASE}/invoices/save`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pending.payload), signal: controller.signal
    });
    const result = await response.json().catch(() => { throw new Error('Save response could not be read. Retry the same request to confirm its outcome.'); });
    if (!response.ok || result.success !== true || typeof result.data?._id !== 'string' || !/^[a-f0-9]{24}$/i.test(result.data._id) || result.data.invoiceNumber !== pending.payload.invoiceNumber ||
        result.operationVersion !== pending.payload.expectedVersion + 1 || result.data.revision !== result.operationVersion ||
        result.data.status !== pending.payload.status || result.data.totalAmount !== pending.payload.totalAmount ||
        !Array.isArray(result.data.operations) || !result.data.operations.some((op) => op.requestId === pending.payload.requestId)) {
      throw new Error('The server did not confirm this exact save. Retry or check History; final printing is blocked.');
    }
    if (state !== current || epoch !== workspaceEpoch || !window.CourierAuth.isAuthenticated()) return false;
    meta.confirmed = { id: result.data._id, invoiceNumber: result.data.invoiceNumber, revision: result.data.revision, status: result.data.status, contentHash: pending.contentHash };
    delete meta.pending;
    const unchanged = contentHash === pending.contentHash && await invoiceHash(invoicePayload(status)) === pending.contentHash;
    meta.dirty = !unchanged;
    if (!saveState(false)) throw new Error('Server saved the invoice, but the device could not retain its receipt. Check History before continuing.');
    if (!unchanged) {
      setInvoiceSaveState('Unsaved', 'The earlier snapshot was saved. Current edits are still unsaved; finalized content requires a correction.');
      return false;
    }
    setInvoiceSaveState('Saved', `${result.data.status === 'DRAFT' ? 'Draft saved. Use Print to finalize.' : 'Finalized and saved.'} Totals are recorded, not independently verified.`);
    if (printAfter && result.data.status === 'GENERATED') finalPrint(result.data);
    return true;
  } catch (error) {
    if (state === current && epoch === workspaceEpoch && [400, 409, 413, 422].includes(error.status)) {
      delete current.persistence?.pending; // Definite rejection: corrected data gets a fresh request ID.
      saveState(false);
    }
    if (state === current && epoch === workspaceEpoch) setInvoiceSaveState(error.code === 'OFFLINE' || navigator.onLine === false ? 'Offline' : 'Failed to save', error.message);
    return false;
  } finally {
    clearTimeout(timeout);
    if (epoch === workspaceEpoch) {
      setInvoiceBusy(false);
      const retry = document.getElementById('retrySaveButton');
      if (retry) retry.hidden = !state?.persistence?.pending;
    }
  }
}
const ARCHIVE_PREFIX = 'courier-bill-archive-';
function archiveCurrentDraft() {
  if (!state) return false;
  try {
    localStorage.setItem(ARCHIVE_PREFIX + crypto.randomUUID(), JSON.stringify({ createdAt: new Date().toISOString(), state }));
    renderDraftArchives();
    return true;
  } catch { alert('Cannot archive this draft: device storage is full. Download a backup first. Nothing was cleared.'); return false; }
}
function renderDraftArchives() {
  const select = document.getElementById('draftArchiveSelect');
  if (!select || !state) return;
  const options = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key.startsWith(ARCHIVE_PREFIX)) continue;
    try { const entry = JSON.parse(localStorage.getItem(key)); options.push({ key, date: entry.createdAt, number: entry.state.bill.invoiceNo }); } catch { /* Keep unreadable archives untouched. */ }
  }
  options.sort((a, b) => b.date.localeCompare(a.date));
  select.innerHTML = options.map((entry) => `<option value="${escapeHtml(entry.key)}">${escapeHtml(entry.number)} — ${escapeHtml(entry.date)}</option>`).join('');
}
function restoreLocalArchive() {
  if (!state || invoiceSaving) return;
  const key = document.getElementById('draftArchiveSelect').value;
  if (!key || !key.startsWith(ARCHIVE_PREFIX)) return;
  const restored = JSON.parse(localStorage.getItem(key));
  if (!confirm('Restore this archived draft? The current draft will be archived first.')) return;
  if (!archiveCurrentDraft()) return;
  const previous = state;
  const previousRecord = historicalRecord;
  state = mergeImportedState(restored.state);
  historicalRecord = null;
  if (!saveState(false)) { state = previous; historicalRecord = previousRecord; return; }
  init(false);
  switchScreen('invoice');
}
function activateWorkspace() {
  if (state || !window.CourierAuth.isAuthenticated()) return;
  workspaceEpoch++;
  localDraftConflict = false;
  try { state = loadState(); } catch (error) {
    const shell = document.querySelector('.app-shell');
    shell.innerHTML = '<p>Stored draft could not be read and was not modified.</p><button id="recoverRawDraft" type="button">Download draft for recovery</button><button id="logoutButton" type="button">Sign out</button>';
    document.getElementById('recoverRawDraft').addEventListener('click', () => {
      if (window.CourierAuth.isAuthenticated()) downloadRecord(localStorage.getItem(STORAGE_KEY), 'unreadable-draft.json');
    });
    return;
  }
  init();
}
function clearPrivateWorkspace() {
  workspaceEpoch++;
  state = null;
  historicalRecord = null;
  invoiceSaving = false;
  document.body.classList.remove('final-print');
  const shell = document.querySelector('.app-shell');
  if (shell) shell.innerHTML = workspaceTemplate;
  const modal = document.getElementById('pdfReviewModal');
  if (modal) { modal.innerHTML = reviewTemplate; modal.hidden = true; modal.style.display = 'none'; }
}
window.addEventListener('courier:auth', (event) => event.detail ? activateWorkspace() : clearPrivateWorkspace());
window.addEventListener('afterprint', () => document.body.classList.remove('final-print'));
window.addEventListener('storage', (event) => {
  if (event.key !== STORAGE_KEY || !state || !window.CourierAuth.isAuthenticated()) return;
  if (event.newValue === JSON.stringify(state)) return;
  const archived = archiveCurrentDraft();
  localDraftConflict = true;
  setInvoiceSaveState('Failed to save', archived ? 'Another tab changed the draft. This tab was archived; reload or restore it from Tools.' : 'Another tab changed the draft. Download a backup from this tab before reloading.');
});
const originalSwitchScreen = switchScreen;
switchScreen = function (target) {
  if (!state || !window.CourierAuth.isAuthenticated()) return;
  originalSwitchScreen(target);
  if (target === 'history') fetchPastInvoices();
};
if (window.CourierAuth.isAuthenticated()) activateWorkspace();

function downloadRecord(data, filename) {
  const url = URL.createObjectURL(new Blob([typeof data === 'string' ? data : JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url);
}
let historyActionBusy = false;
async function handleHistoryAction(event) {
  const button = event.target.closest('button[data-history]');
  if (!button || !state || historyActionBusy || invoiceSaving) return;
  const id = button.closest('[data-invoice-id]').dataset.invoiceId;
  const action = button.dataset.history;
  const epoch = workspaceEpoch;
  const previous = state;
  const previousRecord = historicalRecord;
  let replacing = false;
  historyActionBusy = true;
  setInvoiceBusy(true);
  button.disabled = true;
  try {
    const response = await window.CourierAuth.apiFetch(`${API_BASE}/invoices/${encodeURIComponent(id)}`);
    const result = await response.json();
    if (!result.success || !result.data?._id) throw new Error('Saved invoice could not be confirmed.');
    const invoice = result.data;
    if (epoch !== workspaceEpoch || !state) return;
    if (action === 'download') { downloadRecord(invoice, 'invoice-record.json'); return; }
    if (['PAID', 'CANCELLED'].includes(action)) {
      const key = `courier-invoice-transition-${id}`;
      let pending = JSON.parse(localStorage.getItem(key) || 'null');
      if (pending && pending.status !== action) throw new Error('An earlier status change is unresolved. Retry that action first.');
      if (!pending) {
        const reason = prompt(action === 'PAID' ? 'Payment reference / reason:' : 'Cancellation reason (the original invoice will be retained):');
        if (!reason?.trim()) return;
        pending = { requestId: crypto.randomUUID(), expectedVersion: invoice.revision, status: action, reason: reason.trim() };
        localStorage.setItem(key, JSON.stringify(pending));
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      let changed;
      try { changed = await (await window.CourierAuth.apiFetch(`${API_BASE}/invoices/${id}/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pending), signal: controller.signal })).json(); }
      finally { clearTimeout(timer); }
      if (changed.success !== true || !changed.data?.operations?.some((op) => op.requestId === pending.requestId)) throw new Error('Status change not confirmed. Retry the same action.');
      localStorage.removeItem(key);
      if (epoch === workspaceEpoch && state) { showToast('Status change confirmed.'); await fetchPastInvoices(); }
      return;
    }
    if (!invoice.snapshot) {
      if (action !== 'correct') { downloadRecord(invoice, 'historical-invoice-record.json'); alert('This older record has no complete layout snapshot. The original record was downloaded; it was not changed.'); return; }
      const number = prompt('New invoice number for this correction (must be unique):');
      const reason = prompt('Reason for correction:');
      if (!number?.trim() || !reason?.trim() || !confirm('This older record lacks complete billing metadata. Create an empty linked draft and enter its missing details manually?')) return;
      if (!archiveCurrentDraft()) return;
      replacing = true;
      state = { ...state, bill: { ...state.bill, invoiceNo: number.trim(), shipperCode: invoice.shipperCode, billTo: invoice.clientName || '', gstNo: invoice.clientGst || '' },
        shipments: [], correctionOf: invoice.invoiceNumber, correctionReason: reason.trim(), invoiceMetadata: { client: null, notes: invoice.notes || '' } };
      delete state.persistence;
      if (!saveState()) throw new Error('Could not store the correction draft locally. The current draft is preserved.');
      replacing = false;
      init(false); switchScreen('invoice'); showToast('Linked correction draft created. Complete and verify its details before finalizing.'); return;
    }
    if (!confirm('Open this invoice? Your current local draft will be archived first.')) return;
    let correctedNumber, reason;
    if (action === 'correct') {
      correctedNumber = prompt('New invoice number for this correction (must be unique):');
      reason = prompt('Reason for correction:');
      if (!correctedNumber?.trim() || !reason?.trim()) return;
    }
    if (!archiveCurrentDraft()) return;
    replacing = true;
    state = { bill: structuredClone(invoice.snapshot.bill), rates: structuredClone(invoice.snapshot.rates), shipments: invoice.shipments.map((s) => ({
      id: s.sourceId || crypto.randomUUID(), cno: s.awb, date: s.bookingDate.slice(0, 10), destination: s.destination, origin: s.origin,
      receiverName: s.receiverName, type: s.type || 'D', pcs: s.pcs ?? 1, weight: s.actualWeight, chargedWeight: s.chargedWeight, rate: s.rate, manualAmount: s.manualAmount ?? ''
    })), invoiceMetadata: { client: invoice.client, notes: invoice.notes, dueDate: invoice.dueDate?.slice(0, 10) }, correctionOf: invoice.correctionOf || '', correctionReason: invoice.correctionReason || '' };
    if (action === 'correct') {
      state.bill.invoiceNo = correctedNumber.trim(); state.correctionOf = invoice.invoiceNumber; state.correctionReason = reason.trim();
    } else {
      state.persistence = { confirmed: { id: invoice._id, revision: invoice.revision, status: invoice.status, invoiceNumber: invoice.invoiceNumber,
        contentHash: await invoiceHash(invoicePayload(invoice.status === 'DRAFT' ? 'DRAFT' : 'GENERATED')) } };
    }
    if (epoch !== workspaceEpoch || !state) return;
    historicalRecord = action === 'correct' ? null : invoice;
    if (!saveState(false)) throw new Error('Could not store this recovered draft locally. The previous draft is preserved.');
    replacing = false;
    init(false); switchScreen('invoice');
  } catch (error) {
    if (epoch === workspaceEpoch && state) {
      if (replacing) { state = previous; historicalRecord = previousRecord; }
      alert(error.message);
    }
  }
  finally { historyActionBusy = false; button.disabled = false; if (epoch === workspaceEpoch) setInvoiceBusy(false); }
}

