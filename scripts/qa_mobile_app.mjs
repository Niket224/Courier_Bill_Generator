import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const workspace = process.cwd();
const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const outDir = path.join(workspace, "outputs", "mobile_bill_app");
const userDataDir = path.join(outDir, "edge-profile");
const port = 9222;
const appUrl = "http://127.0.0.1:4173/index.html?qa=cdp";

await fs.mkdir(outDir, { recursive: true });
await fs.mkdir(userDataDir, { recursive: true });

const edge = spawn(edgePath, [
  "--headless=new",
  "--disable-gpu",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${userDataDir}`,
  "--no-first-run",
  "--no-default-browser-check",
  appUrl,
], { stdio: "ignore" });

async function waitForJsonList() {
  const started = Date.now();
  while (Date.now() - started < 12000) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const pages = await response.json();
      const page = pages.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      // Browser is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Edge DevTools endpoint did not start.");
}

const pageInfo = await waitForJsonList();
const ws = new WebSocket(pageInfo.webSocketDebuggerUrl);
const pending = new Map();
let nextId = 1;
const errors = [];

await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve, { once: true });
  ws.addEventListener("error", reject, { once: true });
});

ws.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.method === "Runtime.exceptionThrown") {
    errors.push(message.params?.exceptionDetails?.text || "Runtime exception");
  }
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  }
});

function cdp(method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function evaluate(expression) {
  const result = await cdp("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || "Runtime.evaluate failed");
  }
  return result.result.value;
}

async function screenshot(fileName) {
  const image = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  const filePath = path.join(outDir, fileName);
  await fs.writeFile(filePath, Buffer.from(image.data, "base64"));
  return filePath;
}

try {
  await cdp("Page.enable");
  await cdp("Runtime.enable");
  await cdp("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await cdp("Page.navigate", { url: appUrl });
  await new Promise((resolve) => setTimeout(resolve, 1200));

  await evaluate(`(async () => {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((reg) => reg.unregister()));
    }
    localStorage.removeItem('courier-bill-app-v2');
    location.reload();
    return true;
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 1200));

  const initial = await evaluate(`(() => ({
    title: document.title,
    active: document.querySelector('.screen.active')?.dataset.screen,
    cards: document.querySelectorAll('.shipment-card').length,
    summary: Array.from(document.querySelectorAll('.summary-strip strong')).map((el) => el.textContent),
    hasBottomNav: !!document.querySelector('.bottom-nav')
  }))()`);

  const interaction = await evaluate(`(() => {
    document.getElementById('addShipmentButton').click();
    const cards = Array.from(document.querySelectorAll('.shipment-card'));
    const last = cards[cards.length - 1];
    const cno = last.querySelector('input[data-field="cno"]');
    const weight = last.querySelector('input[data-field="weight"]');
    cno.value = 'TEST450';
    cno.dispatchEvent(new Event('input', { bubbles: true }));
    weight.value = '4.5';
    weight.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('button[data-target="invoice"]').click();
    return {
      cards: document.querySelectorAll('.shipment-card').length,
      lastAmount: last.querySelector('.amount-pill').textContent.trim(),
      summary: Array.from(document.querySelectorAll('.summary-strip strong')).map((el) => el.textContent),
      invoiceActive: document.querySelector('.screen.active')?.dataset.screen,
      invoiceText: document.getElementById('invoicePaper').innerText
    };
  })()`);

  const mobileShot = await screenshot("mobile-invoice.png");

  await cdp("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 720,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await new Promise((resolve) => setTimeout(resolve, 300));
  const desktopShot = await screenshot("desktop-invoice.png");

  const checks = {
    initial,
    interaction,
    screenshots: { mobileShot, desktopShot },
    errors,
  };

  console.log(JSON.stringify(checks, null, 2));
} finally {
  try { ws.close(); } catch {}
  try { edge.kill(); } catch {}
  process.exit(0);
}
