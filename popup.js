// state: "existing" | "kept" | "new"
let tags = [];
let pageUrl = null;

const $ = id => document.getElementById(id);

// Show version from manifest
chrome.runtime.getManifest && document.addEventListener("DOMContentLoaded", () => {
  const v = chrome.runtime.getManifest().version;
  const el = $("version");
  if (el) el.textContent = "v" + v;
});

function setStatus(msg, cls = "") {
  const el = $("status");
  el.textContent = msg;
  el.className = cls;
  el.style.display = "block";
}
function clearStatus() { $("status").style.display = "none"; }

function renderTags() {
  const list = $("tag-list");
  list.innerHTML = "";
  const groups = [
    { state: "existing", label: "Already on Flickr" },
    { state: "kept",     label: "Added" },
    { state: "new",      label: "New suggestions — remove any you don't want" },
  ];
  for (const { state, label } of groups) {
    const group = tags.filter(t => t.state === state);
    if (!group.length) continue;
    const lel = document.createElement("div");
    lel.className = "tag-section-label";
    lel.textContent = label;
    list.appendChild(lel);
    group.forEach(t => list.appendChild(makeChip(t)));
  }
}

function makeChip(tag) {
  const span = document.createElement("span");
  span.className = `tag ${tag.state}`;
  if (tag.state === "existing") {
    span.textContent = tag.text;
  } else {
    span.innerHTML = `${tag.text}<button title="Remove">×</button>`;
    span.querySelector("button").addEventListener("click", () => {
      tags = tags.filter(t => t.text !== tag.text);
      renderTags();
      updateCopyRow();
    });
  }
  return span;
}

function updateCopyRow() {
  const toAdd = tags.filter(t => t.state !== "existing").map(t => t.text);
  if (!toAdd.length) { $("copy-row").style.display = "none"; return; }
  $("copy-row").style.display = "block";
  $("tag-line").value = toAdd.join(" ");
  if (pageUrl) {
    chrome.storage.local.get(pageUrl).then(stored => {
      const entry = stored[pageUrl];
      if (entry) chrome.storage.local.set({ [pageUrl]: { ...entry, reviewedTags: tags } });
    });
  }
}

function showResults(newTagTexts) {
  // Keep existing (Flickr) and kept (manually added) tags, replace new (generated) tags
  tags = tags.filter(t => t.state !== "new");
  const existingTexts = tags.map(t => t.text);
  const toAdd = newTagTexts
    .filter(t => !existingTexts.includes(t))
    .map(t => ({ text: t, state: "new" }));
  tags = [...tags, ...toAdd];
  $("tags-wrap").style.display = "block";
  renderTags();
  updateCopyRow();
}

function resizeToBase64(url) {
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const MAX = 1600;
      let w = img.naturalWidth, h = img.naturalHeight;
      if (w > MAX || h > MAX) {
        if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
        else { w = Math.round(w * MAX / h); h = MAX; }
      }
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL("image/jpeg", 0.85).split(",")[1]);
    };
    img.src = url;
  });
}

let pollTimer = null;

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    const result = await chrome.storage.local.get(pageUrl);
    const entry = result[pageUrl];
    if (!entry || entry.status === "pending") return;
    clearInterval(pollTimer);
    pollTimer = null;
    if (entry.status === "done") {
      showResults(entry.tags);
      clearStatus();
      $("gen-btn").disabled = false;
      $("gen-btn").textContent = "Regenerate tags";
    } else {
      setStatus("Gemini error — server may be busy, try again", "error");
      $("gen-btn").disabled = false;
      $("gen-btn").textContent = "Generate tags";
      chrome.storage.local.remove(pageUrl);
    }
  }, 1000);
}

async function startGeneration(photoUrl, coords, flickrLocation, tabId) {
  const allStored = await chrome.storage.local.get(null);
  const alreadyRunning = Object.values(allStored).some(v => v && v.status === "pending");
  if (alreadyRunning) {
    setStatus("⚠️ Already generating — wait for current one to finish", "warning");
    return;
  }

  setStatus("⏳ Preparing image…");
  $("gen-btn").disabled = true;

  try {
    const base64 = await resizeToBase64(photoUrl);
    await chrome.storage.local.set({ [pageUrl]: { status: "pending", tags: [], timestamp: Date.now() } });
    chrome.runtime.sendMessage({ type: "GENERATE", base64, coords, flickrLocation, tabId, pageUrl });
    setStatus("⚡ Generating in background — you can close this popup", "warning");
    $("gen-btn").textContent = "Generating…";
    startPolling();
  } catch (e) {
    setStatus("Failed to prepare image: " + e.message, "error");
    $("gen-btn").disabled = false;
    $("gen-btn").textContent = "Generate tags";
  }
}

function showKeySetup() {
  $("key-setup").style.display = "block";
  $("main-ui").style.display = "none";
  clearStatus();
}
function hideKeySetup() {
  $("key-setup").style.display = "none";
  $("main-ui").style.display = "block";
}

$("save-key-btn").addEventListener("click", async () => {
  const key = $("api-key-input").value.trim();
  if (!key) return;
  await chrome.storage.local.set({ geminiApiKey: key });
  hideKeySetup();
  setStatus("API key saved.", "success");
  setTimeout(clearStatus, 2000);
});

$("change-key-btn").addEventListener("click", () => showKeySetup());

$("clear-cache-btn").addEventListener("click", async () => {
  const data = await chrome.storage.local.get(null);
  const toRemove = Object.keys(data).filter(k => k.includes("flickr.com"));
  if (toRemove.length) {
    await chrome.storage.local.remove(toRemove);
    tags = tags.filter(t => t.state === "existing");
    renderTags();
    updateCopyRow();
    $("gen-btn").textContent = "Generate tags";
    setStatus("Cached tags cleared.", "success");
    setTimeout(clearStatus, 2000);
  } else {
    setStatus("Nothing to clear.", "");
    setTimeout(clearStatus, 1500);
  }
});

function updateCopyBtnLabel() {
  const autofill = $("autofill-toggle").checked;
  $("copy-btn").textContent = autofill ? "📋 Copy tags and send to Flickr" : "📋 Copy tags to clipboard";
}

chrome.storage.local.get("autofill", ({ autofill }) => {
  $("autofill-toggle").checked = !!autofill;
  updateCopyBtnLabel();
});
$("autofill-toggle").addEventListener("change", () => {
  chrome.storage.local.set({ autofill: $("autofill-toggle").checked });
  updateCopyBtnLabel();
});

$("add-btn").addEventListener("click", () => {
  const input = $("new-tag");
  const t = input.value.trim().toLowerCase().replace(/\s+/g, "-").replace(/^[-]+/, "");
  if (t && t.length > 1 && !tags.find(x => x.text === t)) {
    tags.push({ text: t, state: "kept" });
    renderTags();
    updateCopyRow();
  }
  input.value = "";
  input.focus();
});

$("new-tag").addEventListener("keydown", e => {
  if (e.key === "Enter") $("add-btn").click();
});

$("copy-btn").addEventListener("click", async () => {
  const tagLine = $("tag-line").value;
  const { autofill } = await chrome.storage.local.get("autofill");

  try {
    await navigator.clipboard.writeText(tagLine);
    if (pageUrl) chrome.storage.local.remove(pageUrl);
  } catch {
    $("tag-line").select();
    document.execCommand("copy");
  }

  if (autofill) {
    try {
      $("copy-btn").textContent = "Sending to Flickr…";
      $("copy-btn").className = "copied";
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      chrome.tabs.sendMessage(tab.id, { type: "FILL_TAGS", tags: tagLine }, () => {});
      $("copy-btn").textContent = "Waiting for Flickr…";
      await new Promise(r => setTimeout(r, 4000));
      $("copy-btn").textContent = "✓ Done!";
      await new Promise(r => setTimeout(r, 800));
      window.close();
    } catch (e) {
      setStatus("Auto-fill failed: " + e.message, "error");
    }
  } else {
    $("copy-btn").textContent = "✓ Copied!";
    $("copy-btn").className = "copied";
  }
});

document.addEventListener("DOMContentLoaded", async () => {
  const { geminiApiKey } = await chrome.storage.local.get("geminiApiKey");
  if (!geminiApiKey) { showKeySetup(); return; }
  hideKeySetup();

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab.url?.match(/flickr\.com\/photos\/[^/]+\/\d+/)) {
      const allStored = await chrome.storage.local.get(null);
      const pendingEntry = Object.entries(allStored).find(
        ([url, val]) => url.includes("flickr.com/photos") && val.status === "pending"
      );
      if (pendingEntry) {
        const [pendingUrl, pendingVal] = pendingEntry;
        setStatus("⚠ Please open a Flickr photo page", "error");
        const notFlickrMsg = document.createElement("p");
        notFlickrMsg.style.cssText = "font-size:12px;color:#666;margin-bottom:8px;";
        notFlickrMsg.textContent = pendingVal.status === "pending"
          ? "⚡ Still generating — click below to go back"
          : "✓ Tags are ready — click below to go back";
        $("main-ui").appendChild(notFlickrMsg);
        const goBtn = document.createElement("button");
        goBtn.className = "primary";
        goBtn.style.cssText = "width:100%;margin-top:10px;";
        goBtn.textContent = "↩ Go back to photo";
        goBtn.addEventListener("click", () => {
          chrome.tabs.update(tab.id, { url: pendingUrl });
          window.close();
        });
        $("main-ui").appendChild(goBtn);
        $("main-ui").style.display = "block";
      } else {
        setStatus("⚠ Please open a Flickr photo page", "error");
      }
      return;
    }

    pageUrl = tab.url.split("?")[0].replace(/\/$/, "");
    chrome.runtime.sendMessage({ type: "REFRESH_BADGE", tabId: tab.id });

    const stored = await chrome.storage.local.get(pageUrl);
    const entry = stored[pageUrl];

    let response;
    try {
      response = await chrome.tabs.sendMessage(tab.id, { type: "GET_PHOTO_URL" });
    } catch {
      setStatus("Couldn't connect to page — try refreshing it.", "error");
      return;
    }

    if (response.error) { setStatus(response.error, "error"); return; }

    $("photo").src = response.url;
    $("photo-wrap").style.display = "block";
    $("photo-wrap").addEventListener("click", () => {
      const lensUrl = `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(response.url)}`;
      chrome.tabs.create({ url: lensUrl, active: false });
    });

    if (response.location) $("location").textContent = "📍 " + response.location;

    if (response.existingTags?.length) {
      tags = response.existingTags.map(t => ({ text: t, state: "existing" }));
      $("tags-wrap").style.display = "block";
      renderTags();
    }

    if (entry?.status === "done") {
      if (entry.reviewedTags) {
        tags = entry.reviewedTags;
        $("tags-wrap").style.display = "block";
        renderTags();
        updateCopyRow();
      } else {
        showResults(entry.tags);
      }
      clearStatus();
      $("gen-btn").disabled = false;
      $("gen-btn").textContent = "Regenerate tags";
    } else if (entry?.status === "pending") {
      setStatus("⚡ Generating in background — you can close this popup", "warning");
      $("gen-btn").disabled = true;
      $("gen-btn").textContent = "Generating…";
      startPolling();
    } else {
      clearStatus();
      $("gen-btn").disabled = false;
      $("gen-btn").textContent = "Generate tags";
    }

    $("gen-btn").addEventListener("click", () =>
      startGeneration(response.url, response.coords, response.location, tab.id)
    );

  } catch (e) {
    setStatus("Something went wrong: " + e.message, "error");
  }
});
