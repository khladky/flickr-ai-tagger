const GEMINI_MODEL = "gemini-3.1-flash-lite";
const PROMPT_BASE = `Generate Flickr tags for this photo. Reply with ONLY a comma-separated list of tags, nothing else. Rules: 10-20 tags, all lowercase, multi-word tags MUST use hyphens (e.g. long-exposure, black-and-white), prioritise describing the scene, objects, people, activities and atmosphere, include colours only if they are a distinctive feature, mix of broad and specific terms, suitable for general audience, no hashtags, no phrases or sentences.`;

// The describable part of the title/description instruction — can be overridden
// by placing a user_gdq.txt file in the extension folder.
const DEFAULT_TITLE_DESC_INSTRUCTION = `Generate a short, natural Flickr photo title and a three-to-four sentence description.`;

// Fixed formatting/quality rules — always appended regardless of custom instruction,
// to keep the response parseable and avoid known failure modes.
const TITLE_DESC_RULES = `Reply in EXACTLY this format and nothing else — exactly two lines, no other labels, no extra information:\nTITLE: <title here>\nDESCRIPTION: <description here>\nThe title should be concise (under 10 words), engaging, and not generic. The description should add context a viewer would find interesting — do not just restate the title. Write with confidence — describe what is happening directly, avoid hedging words like "appears to be", "suggests", "possibly", "seems to", "hinting at", "likely". Never use the construction "X suggests Y" or "X hints at Y" for ANY kind of inference — mood, atmosphere, age, history, purpose, or anything else (e.g. do not write "the architectural details suggest historical significance" — instead state it directly, e.g. "the building's classical mouldings reflect its historical significance" or simply describe what is visible without the inference). If you are not confident enough to state something as fact, leave it out entirely rather than hedging or guessing. State things plainly as fact based on what is visible. The description must be normal flowing prose only — never append place names, addresses, or comma-separated location lists at the end. Do not add a location line, hashtags, or any other field.`;

// Attempt to read a user-supplied instruction file bundled in the extension folder.
// Falls back silently to the built-in default if the file is missing or unreadable.
async function getTitleDescInstruction(useCustomPrompt) {
  if (!useCustomPrompt) return { text: DEFAULT_TITLE_DESC_INSTRUCTION, isCustom: false };
  try {
    const res = await fetch(chrome.runtime.getURL("user_gdq.txt"));
    if (!res.ok) return { text: DEFAULT_TITLE_DESC_INSTRUCTION, isCustom: false };
    const text = (await res.text()).trim();
    if (!text) return { text: DEFAULT_TITLE_DESC_INSTRUCTION, isCustom: false };
    return { text, isCustom: true };
  } catch {
    return { text: DEFAULT_TITLE_DESC_INSTRUCTION, isCustom: false };
  }
}

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

function stripTrailingLocationJunk(desc) {
  // Find the last sentence-ending punctuation
  const match = desc.match(/^([\s\S]*?[.!?])\s*([\s\S]*)$/);
  if (!match) return desc;
  const [, sentence, trailing] = match;
  if (!trailing.trim()) return desc;

  // If the trailing text after the last real sentence has no terminal
  // punctuation of its own and is mostly capitalised words (typical of a
  // leaked "Place, Region, Country" style location string), drop it.
  const words = trailing.trim().split(/\s+/);
  const capWords = words.filter(w => /^[A-Z]/.test(w));
  const ratio = capWords.length / words.length;
  const hasTerminalPunctuation = /[.!?]$/.test(trailing.trim());

  if (!hasTerminalPunctuation && ratio > 0.6) {
    return sentence.trim();
  }
  return desc;
}

async function geminiCall(apiKey, base64, prompt, maxTokens) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  let res;
  try {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
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
  } catch (e) {
    if (e.name === "AbortError") throw new Error("timeout");
    throw e;
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401 || res.status === 403) throw new Error("auth");
  if (res.status === 429) throw new Error("rate_limit");
  if (!res.ok) throw new Error("server");
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

async function handleGenerate({ base64, coords, flickrLocation, genTags, genTitleDesc, useCustomPrompt, tabId, pageUrl }) {
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
    await chrome.storage.local.set({ [pageUrl]: { status: "error", errorType: "timeout", tags: [], timestamp: Date.now() } });
    chrome.action.setBadgeText({ text: "!", tabId });
    chrome.action.setBadgeBackgroundColor({ color: "#e53e3e", tabId });
  }, 30000);

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

    // Generate tags (skipped if genTags is false)
    let tags = [];
    if (genTags) {
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
      tags = generalTags.filter(t => {
        if (seen.has(t)) return false;
        seen.add(t);
        return true;
      });

      if (!tags.length) throw new Error("No tags returned");
    }

    // Optional: generate title and description
    let title = null, description = null, usedCustomPrompt = false;
    if (genTitleDesc) {
      try {
        // Use only the most specific 1-2 levels, not the full administrative
        // hierarchy used for tags — a full "Suburb, City, County, Country" string
        // reads awkwardly when stuffed into a sentence.
        const fullLocation = locationText || flickrLocation || null;
        const shortLocation = fullLocation
          ? fullLocation.split(",").slice(0, 2).join(",").trim()
          : null;
        const tdLocationHint = shortLocation
          ? ` If natural, you may mention that this was taken in or near ${shortLocation} — but only as part of normal sentence flow, never as a list or label. If you do mention it, state it plainly and confidently (e.g. "in Manchester"), never with hedging words like "perhaps", "likely", "probably", or "suggests". If you are not reasonably confident about the location, simply leave it out rather than guessing with a qualifier.`
          : "";

        const { text: tdInstruction, isCustom } = await getTitleDescInstruction(useCustomPrompt);
        usedCustomPrompt = isCustom;

        const tdText = await geminiCall(
          geminiApiKey, base64,
          `${tdInstruction}${tdLocationHint} ${TITLE_DESC_RULES}`,
          400
        );
        const titleMatch = tdText.match(/TITLE:\s*(.+)/i);
        const descMatch = tdText.match(/DESCRIPTION:\s*([^\n]+(?:\n(?![A-Z]+:)[^\n]*)*)/i);
        if (titleMatch) title = titleMatch[1].trim();
        if (descMatch) {
          let desc = descMatch[1].trim();
          // Safety net: strip a trailing line that looks like a leaked location
          // (no terminal sentence punctuation, or matches known location strings)
          const lines = desc.split("\n").map(l => l.trim()).filter(Boolean);
          if (lines.length > 1) {
            const last = lines[lines.length - 1];
            const looksLikeLocation =
              !/[.!?]$/.test(last) ||
              (flickrLocation && last.toLowerCase() === flickrLocation.toLowerCase()) ||
              (locationText && last.toLowerCase() === locationText.toLowerCase());
            if (looksLikeLocation) lines.pop();
          }
          description = stripTrailingLocationJunk(lines.join(" ").trim());
        }
      } catch (e) {
        if (e.message === "timeout") throw e; // let outer catch handle timeout
        // Non-fatal — tags still succeed even if title/description fails
      }
    }

    clearTimeout(timeout);
    await chrome.storage.local.set({ [pageUrl]: { status: "done", tags, title, description, usedCustomPrompt, timestamp: Date.now() } });

    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab && activeTab.id === tabId) {
      chrome.action.setBadgeText({ text: "✓", tabId });
      chrome.action.setBadgeBackgroundColor({ color: "#38a169", tabId });
    }

  } catch (e) {
    clearTimeout(timeout);
    const errorType = ["auth", "rate_limit", "server", "timeout"].includes(e.message) ? e.message : "server";
    await chrome.storage.local.set({ [pageUrl]: { status: "error", errorType, tags: [], timestamp: Date.now() } });
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab && activeTab.id === tabId) {
      chrome.action.setBadgeText({ text: "!", tabId });
      chrome.action.setBadgeBackgroundColor({ color: "#e53e3e", tabId });
    }
  }
}
