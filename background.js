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
  if (!res.ok) throw new Error(`Gemini returned ${res.status}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

async function handleGenerate({ base64, location, tabId, pageUrl }) {
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
    // Step 1: identify location visually
    let locationTags = [];
    try {
      const locText = await geminiCall(
        geminiApiKey, base64,
        "Identify the location visible in this photo as several simple tags — specific landmark, place name, area, region, country. Reply with only a comma-separated list, nothing else.",
        80
      );
      locationTags = locText.split(",")
        .map(t => t.trim().toLowerCase().replace(/^[-\s]+/, "").replace(/\s+/g, "-"))
        .filter(t => t.length > 1);
    } catch {}

    // Step 2: generate general tags with location context
    const locationContext = locationTags.length
      ? ` The photo was taken in ${location || "an unknown location"}. Visual location analysis identified these specific places: ${locationTags.join(", ")}. You MUST include ALL of these location tags in your output.`
      : (location ? ` The photo was taken in ${location} — include relevant location tags.` : "");

    const tagText = await geminiCall(
      geminiApiKey, base64,
      PROMPT_BASE + locationContext,
      250
    );

    const generalTags = tagText.split(",")
      .map(t => t.trim().toLowerCase().replace(/^[-\s]+/, "").replace(/\s+/g, "-"))
      .filter(t => t.length > 1);

    // Merge: location tags first, then general tags, deduplicated
    const seen = new Set();
    const tags = [...locationTags, ...generalTags].filter(t => {
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
    await chrome.storage.local.set({ [pageUrl]: { status: "error", tags: [], timestamp: Date.now() } });
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab && activeTab.id === tabId) {
      chrome.action.setBadgeText({ text: "!", tabId });
      chrome.action.setBadgeBackgroundColor({ color: "#e53e3e", tabId });
    }
  }
}
