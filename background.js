const GEMINI_MODEL = "gemini-2.5-flash-lite";
const PROMPT_BASE = `Generate Flickr tags for this photo. Reply with ONLY a comma-separated list of tags, nothing else. Rules: 10-20 tags, all lowercase, multi-word tags MUST use hyphens (e.g. long-exposure, black-and-white), prioritise describing the scene, objects, people, activities and atmosphere, include colours only if they are a distinctive feature, mix of broad and specific terms, suitable for general audience, no hashtags, no phrases or sentences.`;

chrome.runtime.onInstalled.addListener(async () => {
  await clearStalePending();
  await injectIntoExistingTabs();
});
chrome.runtime.onStartup.addListener(async () => {
  await clearStalePending();
  await injectIntoExistingTabs();
});

async function clearStalePending() {
  const all = await chrome.storage.local.get(null);
  const toRemove = Object.entries(all)
    .filter(([k, v]) => v && v.status === "pending")
    .map(([k]) => k);
  if (toRemove.length) await chrome.storage.local.remove(toRemove);
}

async function injectIntoExistingTabs() {
  const tabs = await chrome.tabs.query({ url: "https://www.flickr.com/photos/*/*" });
  for (const tab of tabs) {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    } catch {}
  }
}

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  await updateBadgeForTab(tabId);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.url) await updateBadgeForTab(tabId);
});

async function updateBadgeForTab(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url) { chrome.action.setBadgeText({ text: "", tabId }); return; }
    const pageUrl = tab.url.split("?")[0].replace(/\/$/, "");
    const stored = await chrome.storage.local.get(pageUrl);
    const entry = stored[pageUrl];
    if (entry?.status === "done") {
      chrome.action.setBadgeText({ text: "✓", tabId });
      chrome.action.setBadgeBackgroundColor({ color: "#38a169", tabId });
    } else if (entry?.status === "pending") {
      chrome.action.setBadgeText({ text: "…", tabId });
      chrome.action.setBadgeBackgroundColor({ color: "#4285f4", tabId });
    } else {
      chrome.action.setBadgeText({ text: "", tabId });
    }
  } catch {}
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "REFRESH_BADGE") {
    updateBadgeForTab(msg.tabId);
    sendResponse({ ok: true });
    return false;
  }
  if (msg.type !== "GENERATE") return false;
  handleGenerate(msg).catch(console.error);
  sendResponse({ started: true });
  return false;
});

async function reverseGeocode(lat, lon) {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=14&addressdetails=1`,
      { headers: { "User-Agent": "FlickrAITagger/1.0 (flickr photo tagging extension)" } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const a = data.address || {};
    const parts = [
      a.suburb || a.neighbourhood || a.quarter || a.village || a.hamlet,
      a.city || a.town || a.municipality,
      a.county || a.state_district || a.province,
      a.state || a.region,
      a.country
    ].filter(Boolean);
    return parts.length ? parts.join(", ") : null;
  } catch {
    return null;
  }
}

async function geminiCall(apiKey, base64, prompt, maxTokens) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { inline_data: { mime_type: "image/jpeg", data: base64 } },
            { text: prompt }
          ]
        }],
        generationConfig: { temperature: 0.2, maxOutputTokens: maxTokens }
      })
    }
  );
  if (res.status === 401 || res.status === 403) throw new Error("auth");
  if (res.status === 429) throw new Error("rate_limit");
  if (!res.ok) throw new Error("server");
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

async function handleGenerate({ base64, coords, flickrLocation, tabId, pageUrl }) {
  chrome.action.setBadgeText({ text: "…", tabId });
  chrome.action.setBadgeBackgroundColor({ color: "#4285f4", tabId });

  const { geminiApiKey } = await chrome.storage.local.get("geminiApiKey");
  if (!geminiApiKey) {
    await chrome.storage.local.set({ [pageUrl]: { status: "error", tags: [], timestamp: Date.now() } });
    chrome.action.setBadgeText({ text: "!", tabId });
    chrome.action.setBadgeBackgroundColor({ color: "#e53e3e", tabId });
    return;
  }

  const timeout = setTimeout(async () => {
    await chrome.storage.local.set({ [pageUrl]: { status: "error", tags: [], timestamp: Date.now() } });
    chrome.action.setBadgeText({ text: "!", tabId });
    chrome.action.setBadgeBackgroundColor({ color: "#e53e3e", tabId });
  }, 60000);

  try {
    // Step 1: reverse geocode via Nominatim
    let locationText = null;
    if (coords) {
      locationText = await reverseGeocode(coords.lat, coords.lon);
    }

    // Build location context from Nominatim and Flickr data
    const locationSources = [];
    if (flickrLocation) locationSources.push(`Flickr location: "${flickrLocation}"`);
    if (locationText) locationSources.push(`GPS reverse geocoded to: "${locationText}"`);

    const locationContext = locationSources.length
      ? ` Location data: ${locationSources.join(". ")}. Include relevant location tags from specific neighbourhood level down to country.`
      : "";

    // Generate tags
    const tagText = await geminiCall(
      geminiApiKey, base64,
      PROMPT_BASE + locationContext,
      250
    );

    const generalTags = tagText.split(",")
      .map(t => t.trim().toLowerCase().replace(/^[-\s]+/, "").replace(/\s+/g, "-"))
      .filter(t => t.length > 1);

    // Deduplicate tags
    const seen = new Set();
    const tags = generalTags.filter(t => {
      if (seen.has(t)) return false;
      seen.add(t);
      return true;
    });

    if (!tags.length) throw new Error("No tags returned");

    clearTimeout(timeout);
    await chrome.storage.local.set({ [pageUrl]: { status: "done", tags, timestamp: Date.now() } });

    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab && activeTab.id === tabId) {
      chrome.action.setBadgeText({ text: "✓", tabId });
      chrome.action.setBadgeBackgroundColor({ color: "#38a169", tabId });
    }

  } catch (e) {
    clearTimeout(timeout);
    const errorType = ["auth", "rate_limit", "server"].includes(e.message) ? e.message : "server";
    await chrome.storage.local.set({ [pageUrl]: { status: "error", errorType, tags: [], timestamp: Date.now() } });
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab && activeTab.id === tabId) {
      chrome.action.setBadgeText({ text: "!", tabId });
      chrome.action.setBadgeBackgroundColor({ color: "#e53e3e", tabId });
    }
  }
}
