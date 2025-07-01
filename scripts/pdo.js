const { chromium } = require('playwright');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled']
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  });

  const page = await context.newPage();

  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  let headersCaptured = {};
  let streamSent = false;
  const payload = {
    time: new Date().toISOString(),
    headers: {
      'x-api-platform': 'web-desktop',
      'content-type': 'application/json'
    }
  };

  const STREAM_IDS = [204, 205, 206, 18105];

  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('/livestreamings/') && url.includes('initialize=true')) {
      const h = request.headers();
      if (h['x-signature'] && h['x-client'] && h['x-api-key'] && h['x-secure-level'] && !streamSent) {
        headersCaptured = {
          'x-signature': h['x-signature'],
          'x-client': h['x-client'],
          'x-api-key': h['x-api-key'],
          'x-secure-level': h['x-secure-level']
        };
        Object.assign(payload.headers, headersCaptured);
        streamSent = true;
        console.log('✅ Headers captured:', headersCaptured);
      }
    }
  });

  console.log('🌐 Navigating...');
  await page.goto('https://www.vidio.com/live/204', {
    waitUntil: 'domcontentloaded',
    timeout: 90000
  });

  for (let i = 0; i < 15; i++) {
    if (headersCaptured['x-api-key']) break;
    console.log(`⏳ Waiting for headers... (${i + 1})`);
    await new Promise(res => setTimeout(res, 1000));
  }

  if (!headersCaptured['x-api-key']) {
    console.warn('❌ Gagal mendapatkan headers (x-api-key). Program dihentikan.');
    await browser.close();
    return;
  }

  for (const id of STREAM_IDS) {
    try {
      const res = await fetch(`https://api.vidio.com/livestreamings/${id}/stream?initialize=true`, {
        headers: headersCaptured
      });
      const json = await res.json();
      const attr = json?.data?.attributes || {};
      payload.headers[`${id}-dash`] = attr.dash || null;
      payload.headers[`${id}-hls`] = attr.hls || null;
    } catch (err) {
      console.warn(`⚠️ Gagal fetch stream ID ${id}:`, err);
    }
  }

  try {
    await fetch("https://tesvidio.jeffrybp1991.workers.dev", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    console.log("📡 Data dikirim ke Worker");
  } catch (err) {
    console.warn("❌ Gagal kirim ke Worker:", err);
  }

  await browser.close();
})();
