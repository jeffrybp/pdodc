import { chromium } from 'playwright';
import fetch from 'node-fetch';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  let headersCaptured = {};
  let emailUser = null;
  let streamSent = false;

  const STREAM_IDS = [204, 205, 206, 18105];
  const SECTION_URLS = ["https://api.vidio.com/sections/4840-pertandingan-hari-ini"];
  const SECTION_URLS2 = ["https://api.vidio.com/sections/165-siaran-favorit", "https://api.vidio.com/sections/4552-siaran-untukmu"];
  const EXCLUDED_SECTION_IDS = [];

  const payload = {
    time: new Date().toISOString(),
    sections: {},
    vidioliveothers: {},
    headers: {
      "x-api-platform": "web-desktop",
      "content-type": "application/json"
    }
  };

  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('/livestreamings/') && url.includes('initialize=true')) {
      const h = request.headers();
      if (h['x-signature'] && h['x-client'] && h['x-api-key'] && h['x-secure-level'] && !streamSent) {
        headersCaptured = {
          "x-signature": h['x-signature'],
          "x-client": h['x-client'],
          "x-api-key": h['x-api-key'],
          "x-secure-level": h['x-secure-level']
        };
        Object.assign(payload.headers, headersCaptured);
        streamSent = true;
        console.log("✅ Headers captured:", headersCaptured);
      }
    }
  });

  await page.goto('https://www.vidio.com/live/204', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForRequest(req => req.url().includes('initialize=true'), { timeout: 10000 }).catch(() => {});

  try {
    emailUser = await page.evaluate(async () => {
      const res = await fetch('https://www.vidio.com/interactions.json?livestreaming_id=204');
      const json = await res.json();
      return json?.current_user?.email || null;
    });
    payload.headers["x-user-email"] = emailUser;
  } catch (err) {
    console.warn("⚠️ Gagal ambil email user:", err);
  }

  for (const id of STREAM_IDS) {
    if (!headersCaptured['x-api-key']) continue;
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

  const liveIdsSet = new Set();
  for (const sectionUrl of SECTION_URLS) {
    try {
      const res = await fetch(sectionUrl, { headers: headersCaptured });
      const json = await res.json();
      for (const item of json.included || []) {
        const attr = item?.attributes || {};
        const sectionId = attr.section_id;
        if (!EXCLUDED_SECTION_IDS.includes(sectionId)) {
          const contentId = attr.content_id;
          const title = attr.title;
          const webUrl = attr.web_url;
          const coverUrl = attr.cover_url;
          const startTime = attr.start_time;
          const match = webUrl?.match(/\/live\/(\d+)-/);
          const idLive = match ? match[1] : null;
          if (contentId && title && idLive && coverUrl && startTime) {
            payload.sections[contentId] = { title, web_url: idLive, cover_url: coverUrl, start_time: startTime };
            liveIdsSet.add(idLive);
          }
        }
      }
    } catch {}
  }

  const liveIdsSet2 = new Set();
  for (const sectionUrl of SECTION_URLS2) {
    try {
      const res = await fetch(sectionUrl, { headers: headersCaptured });
      const json = await res.json();
      for (const item of json.included || []) {
        const attr = item?.attributes || {};
        const sectionId = attr.section_id;
        if (!EXCLUDED_SECTION_IDS.includes(sectionId)) {
          const contentId = attr.content_id;
          const title = attr.title;
          const webUrl = attr.web_url;
          const coverUrl = attr.cover_url;
          const startTime = attr.start_time;
          const match = webUrl?.match(/\/live\/(\d+)-/);
          const idLive = match ? match[1] : null;
          if (contentId && title && idLive && coverUrl && startTime) {
            payload.vidioliveothers[contentId] = { title, web_url: idLive, cover_url: coverUrl, start_time: startTime };
            liveIdsSet2.add(idLive);
          }
        }
      }
    } catch {}
  }

  if (liveIdsSet.size > 0) {
    payload.headers["all-sections"] = [...liveIdsSet].sort().join("-");
  }

  try {
    const res = await fetch("https://api.vidio.com/categories/daftar-channel-tv-radio-live-sports/sections?page[number]=1&page[size]=100", {
      headers: headersCaptured
    });
    const json = await res.json();
    const allChannelData = [];
    for (const item of json.included || []) {
      const attr = item?.attributes || {};
      if (item.type === "content" && attr.content_id && attr.title && attr.cover_url) {
        allChannelData.push({
          content_id: String(attr.content_id),
          nama_channel: attr.title,
          cover_url: attr.cover_url
        });
      }
    }
    payload.headers["all-vidiolivetv"] = allChannelData;

    const contentIdSet = new Set(allChannelData.map(i => String(i.content_id)));
    let removed = 0;
    for (const [key, val] of Object.entries(payload.vidioliveothers)) {
      if (val.web_url && contentIdSet.has(String(val.web_url))) {
        delete payload.vidioliveothers[key];
        removed++;
      }
    }
    console.log(`🧹 ${removed} vidioliveothers dihapus karena duplikat`);
  } catch (err) {
    console.warn("❌ Gagal ambil all-vidiolivetv:", err);
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
