// state: "existing" | "kept" | "new"
let tags = [];
let previousTags = null; // for undo
let editingTag = null;  // { text, state } of tag currently being edited
let pageUrl = null;
let currentExif = null; // raw EXIF data from content script, for live toggle

const $ = id => document.getElementById(id);

// Arrow key navigation — works even while popup is open, skips when typing in a field
document.addEventListener("keydown", async (e) => {
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  const active = document.activeElement;
  const tagName = active ? active.tagName : "";
  const isEditable = tagName === "INPUT" || tagName === "TEXTAREA" || (active && active.isContentEditable);
  if (isEditable) return;
  if (!pageUrl) return; // not yet on a recognised Flickr photo page

  e.preventDefault();
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    chrome.tabs.sendMessage(tab.id, { type: "NAVIGATE", direction: e.key === "ArrowLeft" ? "prev" : "next" });
  } catch {}
  window.close();
});

// Show version from manifest and link to GitHub
chrome.runtime.getManifest && document.addEventListener("DOMContentLoaded", () => {
  const v = chrome.runtime.getManifest().version;
  const el = $("version");
  if (el) {
    el.textContent = "v" + v;
    el.addEventListener("click", () => {
      chrome.tabs.create({ url: "https://github.com/khladky/flickr-ai-tagger", active: false });
    });
  }
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
    { state: "exif",     label: "Added from EXIF" },
    { state: "editing",  label: "Editing" },
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
  } else if (tag.state === "exif") {
    span.innerHTML = `${tag.text}<button title="Remove">×</button>`;
    span.querySelector("button").addEventListener("click", () => {
      tags = tags.filter(t => t.text !== tag.text);
      renderTags();
      updateCopyRow();
    });
  } else if (tag.state === "editing") {
    span.innerHTML = `${tag.text}<button title="Cancel edit">×</button>`;
    span.querySelector("button").addEventListener("click", () => {
      // Cancel — restore original state
      if (editingTag) {
        const { text: origText, state: origState } = editingTag;
        editingTag = null;
        tags = tags.map(t => t.state === "editing" ? { text: origText, state: origState } : t);
        $("new-tag").value = "";
        renderTags();
        updateCopyRow();
      }
    });
  } else {
    span.title = "Alt+click to edit";
    span.innerHTML = `${tag.text}<button title="Remove">×</button>`;
    span.querySelector("button").addEventListener("click", () => {
      tags = tags.filter(t => t.text !== tag.text);
      renderTags();
      updateCopyRow();
    });
    span.addEventListener("click", e => {
      if (!e.altKey) return;
      e.preventDefault();
      const input = $("new-tag");
      // Restore any previously editing tag first
      if (editingTag) {
        const { text: origText, state: origState } = editingTag;
        tags = tags.map(t => t.state === "editing" ? { text: origText, state: origState } : t);
      }
      // Save pending input as kept tag
      const pending = input.value.trim().toLowerCase().replace(/\s+/g, "-").replace(/^[-]+/, "");
      if (pending.length > 0 && !tags.some(x => x.text === pending)) {
        tags = [...tags, { text: pending, state: "kept" }];
      }
      // Mark this tag as editing
      editingTag = { text: tag.text, state: tag.state };
      tags = tags.map(t => t.text === tag.text && t.state === tag.state ? { ...t, state: "editing" } : t);
      renderTags();
      updateCopyRow();
      input.value = tag.text.replace(/-/g, " ");
      input.focus();
      input.select();
    });
  }
  return span;
}

function updateCopyRow() {
  const toAdd = tags.filter(t => t.state !== "existing" && t.state !== "editing").map(t => t.text);
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
  // Save current state for undo
  previousTags = [...tags];
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
      await showTitleDesc(entry.title, entry.description, entry.usedCustomPrompt);
      if (!entry.usedCustomPrompt) {
        setStatus("✓ Gemini results received", "success");
        setTimeout(clearStatus, 1500);
      }
      $("gen-btn").disabled = false;
      $("gen-btn").textContent = "Regenerate";
    } else {
      const errorType = entry.errorType || "server";
      const errorMsg = errorType === "auth"
        ? "Gemini error — invalid API key, check your key"
        : errorType === "rate_limit"
        ? "Gemini rate limit reached — try again in a moment"
        : errorType === "timeout"
        ? "Gemini timed out — try again"
        : "Gemini error — server busy, try again";
      setStatus(errorMsg, "error");
      $("gen-btn").disabled = false;
      $("gen-btn").textContent = "Generate";
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

  const { genTags, titleDesc, useCustomPrompt } = await chrome.storage.local.get(["genTags", "titleDesc", "useCustomPrompt"]);
  const wantTags = genTags === undefined ? true : !!genTags;
  const wantTitleDesc = !!titleDesc;
  const wantCustomPrompt = !!useCustomPrompt;

  if (!wantTags && !wantTitleDesc) {
    setStatus("⚠️ Nothing selected to generate — tick Generate Flickr tags and/or Generate title & description", "warning");
    return;
  }

  $("gen-btn").disabled = true;
  $("gen-btn").textContent = "Reading photo…";
  setStatus("⏳ Preparing image…");

  try {
    const base64 = await resizeToBase64(photoUrl);
    await chrome.storage.local.set({ [pageUrl]: { status: "pending", tags: [], timestamp: Date.now() } });
    chrome.runtime.sendMessage({ type: "GENERATE", base64, coords, flickrLocation, genTags: wantTags, genTitleDesc: wantTitleDesc, useCustomPrompt: wantCustomPrompt, tabId, pageUrl });
    setStatus("⚡ Asking Gemini — you can close this popup", "warning");
    $("gen-btn").textContent = "Asking Gemini…";
    startPolling();
  } catch (e) {
    setStatus("Failed to prepare image: " + e.message, "error");
    $("gen-btn").disabled = false;
    $("gen-btn").textContent = "Generate";
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
    $("gen-btn").textContent = "Generate";
    setStatus("Cached tags cleared.", "success");
    setTimeout(clearStatus, 2000);
  } else {
    setStatus("Nothing to clear.", "");
    setTimeout(clearStatus, 1500);
  }
});

// Generate Flickr tags toggle — default true (checked)
chrome.storage.local.get("genTags", ({ genTags }) => {
  $("gentags-toggle").checked = genTags === undefined ? true : !!genTags;
});
$("gentags-toggle").addEventListener("change", () => {
  chrome.storage.local.set({ genTags: $("gentags-toggle").checked });
});

// EXIF toggle
chrome.storage.local.get("includeExif", ({ includeExif }) => {
  $("exif-toggle").checked = !!includeExif;
});
$("exif-toggle").addEventListener("change", () => {
  const checked = $("exif-toggle").checked;
  chrome.storage.local.set({ includeExif: checked });

  if (!currentExif) return; // photo data not loaded yet (e.g. on a non-Flickr page)

  if (checked) {
    const exifTags = buildExifTags(currentExif);
    if (exifTags.length > 0) {
      const existingTexts = tags.map(t => t.text);
      const toAdd = exifTags
        .filter(t => !existingTexts.includes(t))
        .map(t => ({ text: t, state: "exif" }));
      if (toAdd.length > 0) {
        tags = [...tags, ...toAdd];
        $("tags-wrap").style.display = "block";
        renderTags();
        updateCopyRow();
      }
    } else {
      setStatus("No camera data available for this photo.", "");
      setTimeout(clearStatus, 3000);
    }
  } else {
    // Remove any EXIF tags currently shown
    tags = tags.filter(t => t.state !== "exif");
    renderTags();
    updateCopyRow();
  }
});

// Title & description toggle
function updateCustomPromptRowVisibility() {
  $("custom-prompt-row").style.display = $("titledesc-toggle").checked ? "flex" : "none";
}

chrome.storage.local.get("titleDesc", ({ titleDesc }) => {
  $("titledesc-toggle").checked = !!titleDesc;
  updateCustomPromptRowVisibility();
});
$("titledesc-toggle").addEventListener("change", () => {
  chrome.storage.local.set({ titleDesc: $("titledesc-toggle").checked });
  updateCustomPromptRowVisibility();
});

// Custom prompt (user_gdq.txt) toggle
(async () => {
  const { useCustomPrompt } = await chrome.storage.local.get("useCustomPrompt");
  if (useCustomPrompt !== undefined) {
    // User has an explicit saved preference — use it regardless of file presence
    $("custom-prompt-toggle").checked = useCustomPrompt;
  } else {
    // First time — default to checked only if user_gdq.txt actually exists
    try {
      const res = await fetch(chrome.runtime.getURL("user_gdq.txt"));
      const text = res.ok ? (await res.text()).trim() : "";
      $("custom-prompt-toggle").checked = !!text;
    } catch {
      $("custom-prompt-toggle").checked = false;
    }
  }
})();
$("custom-prompt-toggle").addEventListener("change", () => {
  chrome.storage.local.set({ useCustomPrompt: $("custom-prompt-toggle").checked });
});

$("copy-title-btn").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("title-line").value);
    $("copy-title-btn").textContent = "✓";
    setTimeout(() => $("copy-title-btn").textContent = "📋", 1500);
  } catch {}
});

$("copy-desc-btn").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("desc-line").value);
    $("copy-desc-btn").textContent = "✓";
    setTimeout(() => $("copy-desc-btn").textContent = "📋", 1500);
  } catch {}
});

// Mutually exclusive title/description append-replace checkboxes, with persistence
function saveTitleDescModes() {
  chrome.storage.local.set({
    titleMode: $("title-replace").checked ? "replace" : $("title-append").checked ? "append" : "skip",
    descMode: $("desc-replace").checked ? "replace" : $("desc-append").checked ? "append" : "skip"
  });
}

chrome.storage.local.get(["titleMode", "descMode"], ({ titleMode, descMode }) => {
  if (titleMode === "replace") {
    $("title-replace").checked = true; $("title-append").checked = false;
  } else if (titleMode === "skip") {
    $("title-replace").checked = false; $("title-append").checked = false;
  } // else leave default (append checked)

  if (descMode === "replace") {
    $("desc-replace").checked = true; $("desc-append").checked = false;
  } else if (descMode === "skip") {
    $("desc-replace").checked = false; $("desc-append").checked = false;
  }
});

$("title-append").addEventListener("change", () => {
  if ($("title-append").checked) $("title-replace").checked = false;
  saveTitleDescModes();
});
$("title-replace").addEventListener("change", () => {
  if ($("title-replace").checked) $("title-append").checked = false;
  saveTitleDescModes();
});
$("desc-append").addEventListener("change", () => {
  if ($("desc-append").checked) $("desc-replace").checked = false;
  saveTitleDescModes();
});
$("desc-replace").addEventListener("change", () => {
  if ($("desc-replace").checked) $("desc-append").checked = false;
  saveTitleDescModes();
});

$("send-titledesc-btn").addEventListener("click", async () => {
  const title = $("title-line").value;
  const description = $("desc-line").value;
  const titleMode = $("title-replace").checked ? "replace" : $("title-append").checked ? "append" : "skip";
  const descMode = $("desc-replace").checked ? "replace" : $("desc-append").checked ? "append" : "skip";
  const btn = $("send-titledesc-btn");
  btn.disabled = true;
  btn.textContent = "Sending to Flickr…";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const result = await chrome.tabs.sendMessage(tab.id, {
      type: "FILL_TITLE_DESC", title, description, titleMode, descMode
    });
    if (result?.error) {
      setStatus("Failed to send: " + result.error, "error");
      btn.textContent = "Send title & description to Flickr";
    } else {
      btn.textContent = "✓ Sent — click again to resend";
      setTimeout(() => {
        if (btn.textContent === "✓ Sent — click again to resend") {
          btn.textContent = "Send title & description to Flickr";
        }
      }, 2500);
    }
  } catch (e) {
    setStatus("Failed to send: " + e.message, "error");
    btn.textContent = "Send title & description to Flickr";
  }
  btn.disabled = false;
});

async function showTitleDesc(title, description, usedCustomPrompt) {
  const { titleDesc } = await chrome.storage.local.get("titleDesc");
  if (!title && !description) {
    $("title-line").value = "";
    $("desc-line").value = "";
    if (titleDesc) {
      setStatus("⚠️ Gemini did not return a title/description — try regenerating", "warning");
    }
    return;
  }
  $("title-line").value = title || "";
  $("desc-line").value = description || "";
  if (usedCustomPrompt) {
    setStatus("⚠️ Using custom prompt from user_gdq.txt", "warning");
    setTimeout(clearStatus, 4000);
  }
}

function isZeroOrEmpty(val) {
  if (!val) return true;
  const v = val.trim().replace(/[^0-9.]/g, "");
  return v === "" || v === "0" || v === "0.0";
}

function buildExifTags(exif) {
  const tags = [];
  if (!exif || Object.keys(exif).length === 0) return tags;

  // Camera make/model — clean up and hyphenate
  if (exif.camera && exif.camera.trim()) {
    tags.push(exif.camera.toLowerCase().replace(/\s+/g, "-"));
  }

  // Lens model — skip if N/A, empty or very long
  if (exif.lensModel && exif.lensModel !== "N/A" && exif.lensModel !== "n/a"
      && exif.lensModel.trim() && exif.lensModel.length < 60) {
    tags.push(exif.lensModel.toLowerCase().replace(/\//g, "").replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""));
  }

  // Focal length — prefer 35mm equivalent, parse to clean number
  const fl = exif.focalLength35 || exif.focalLength;
  if (fl && !isZeroOrEmpty(fl)) {
    const flMatch = fl.match(/([\d.]+)\s*mm/i);
    if (flMatch) {
      const num = parseFloat(flMatch[1]);
      if (num > 0) {
        const tag = (num % 1 === 0 ? num.toFixed(0) : flMatch[1]) + "mm";
        tags.push(tag);
      }
    }
  }

  // Aperture — skip if zero
  if (exif.aperture && !isZeroOrEmpty(exif.aperture)) {
    tags.push(exif.aperture.replace("ƒ/", "f").replace(/\s+/g, "").toLowerCase());
  }

  // ISO — skip if zero
  if (exif.iso && !isZeroOrEmpty(exif.iso)) {
    tags.push("iso-" + exif.iso.replace(/\s+/g, ""));
  }

  // Shutter speed + long exposure detection
  if (exif.shutter && !isZeroOrEmpty(exif.shutter)) {
    tags.push(exif.shutter.replace(/\s+/g, "") + "s");
    const match = exif.shutter.match(/^(\d+)(?:\/(\d+))?/);
    if (match) {
      const seconds = match[2] ? parseInt(match[1]) / parseInt(match[2]) : parseInt(match[1]);
      if (seconds >= 1) tags.push("long-exposure");
    }
  }

  return tags.filter(t => t.length > 1);
}

function flashTag(text) {
  // Find the chip with this text and flash it
  const chips = document.querySelectorAll('.tag');
  for (const chip of chips) {
    if (chip.textContent.trim().startsWith(text)) {
      const orig = chip.style.background;
      chip.style.transition = "background 0.15s";
      chip.style.background = "#ff3333";
      setTimeout(() => {
        chip.style.background = orig;
        setTimeout(() => chip.style.transition = "", 300);
      }, 600);
      break;
    }
  }
}

$("copy-tagline-btn").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("tag-line").value);
    $("copy-tagline-btn").textContent = "✓";
    setTimeout(() => $("copy-tagline-btn").textContent = "📋", 1500);
  } catch {}
});

$("add-btn").addEventListener("click", () => {
  const input = $("new-tag");
  const t = input.value.trim().toLowerCase().replace(/\s+/g, "-").replace(/^[-]+/, "");

  if (editingTag) {
    const { text: origText, state: origState } = editingTag;
    editingTag = null;
    if (t.length > 0) {
      if (!tags.some(x => x.text === t && x.state !== "editing")) {
        tags = tags.map(tag => tag.state === "editing" ? { text: t, state: origState } : tag);
      } else {
        // Duplicate — restore original and flash the existing tag
        tags = tags.map(tag => tag.state === "editing" ? { text: origText, state: origState } : tag);
        renderTags();
        updateCopyRow();
        flashTag(t);
        input.focus();
        input.select();
        return;
      }
    } else {
      tags = tags.map(tag => tag.state === "editing" ? { text: origText, state: origState } : tag);
    }
  } else {
    if (!t || t.length === 0) return;
    if (tags.find(x => x.text === t)) {
      // Duplicate — flash the existing tag
      flashTag(t);
      input.focus();
      input.select();
      return;
    }
    tags.push({ text: t, state: "kept" });
  }

  input.value = "";
  input.focus();
  renderTags();
  updateCopyRow();
});

$("new-tag").addEventListener("keydown", e => {
  if (e.key === "Enter") $("add-btn").click();
  if (e.key === "Escape" && editingTag) {
    // Escape cancels edit and restores original
    const { text: origText, state: origState } = editingTag;
    editingTag = null;
    tags = tags.map(t => t.state === "editing" ? { text: origText, state: origState } : t);
    $("new-tag").value = "";
    renderTags();
    updateCopyRow();
  }
});

$("copy-btn").addEventListener("click", async () => {
  const tagLine = $("tag-line").value;

  try {
    await navigator.clipboard.writeText(tagLine);
  } catch {
    $("tag-line").select();
    document.execCommand("copy");
  }

  try {
    $("copy-btn").textContent = "Sending to Flickr…";
    $("copy-btn").className = "copied";
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const sendPromise = chrome.tabs.sendMessage(tab.id, { type: "FILL_TAGS", tags: tagLine });
    const waitingTimer = setTimeout(() => {
      if ($("copy-btn").textContent === "Sending to Flickr…") $("copy-btn").textContent = "Waiting for Flickr…";
    }, 500);
    const result = await sendPromise;
    clearTimeout(waitingTimer);

    if (result?.error) {
      setStatus("Auto-fill failed: " + result.error, "error");
      $("copy-btn").textContent = "📋 Send tags to Flickr";
      $("copy-btn").className = "";
      return;
    }

    // Success — promote sent tags to "existing" so they no longer show as new/kept
    tags = tags.map(t =>
      (t.state === "new" || t.state === "kept" || t.state === "exif")
        ? { text: t.text, state: "existing" }
        : t
    );
    renderTags();
    updateCopyRow();

    $("copy-btn").textContent = "✓ Done!";
    const { titleDesc } = await chrome.storage.local.get("titleDesc");
    if (!titleDesc) {
      await new Promise(r => setTimeout(r, 800));
      window.close();
    }
  } catch (e) {
    setStatus("Auto-fill failed: " + e.message, "error");
    $("copy-btn").textContent = "📋 Send tags to Flickr";
    $("copy-btn").className = "";
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
      // Content script not running — inject it and try once more
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
        await new Promise(r => setTimeout(r, 500));
        response = await chrome.tabs.sendMessage(tab.id, { type: "GET_PHOTO_URL" });
      } catch {
        setStatus("Couldn't connect to page — try refreshing it.", "error");
        return;
      }
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

    // Add EXIF tags if toggle is on
    currentExif = response.exif;
    const { includeExif } = await chrome.storage.local.get("includeExif");
    if (includeExif) {
      const exifTags = buildExifTags(response.exif);
      if (exifTags.length > 0) {
        const existingTexts = tags.map(t => t.text);
        const toAdd = exifTags
          .filter(t => !existingTexts.includes(t))
          .map(t => ({ text: t, state: "exif" }));
        if (toAdd.length > 0) {
          tags = [...tags, ...toAdd];
          $("tags-wrap").style.display = "block";
          renderTags();
          updateCopyRow();
        }
      } else {
        setStatus("No camera data available for this photo.", "");
        setTimeout(clearStatus, 3000);
      }
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
      showTitleDesc(entry.title, entry.description, entry.usedCustomPrompt);
      clearStatus();
      $("gen-btn").disabled = false;
      $("gen-btn").textContent = "Regenerate";
    } else if (entry?.status === "pending") {
      setStatus("⚡ Generating in background — you can close this popup", "warning");
      $("gen-btn").disabled = true;
      $("gen-btn").textContent = "Generating…";
      startPolling();
    } else {
      clearStatus();
      $("gen-btn").disabled = false;
      $("gen-btn").textContent = "Generate";
    }

    $("gen-btn").addEventListener("click", e => {
      if (e.altKey) {
        if (!previousTags) return;
        tags = [...previousTags];
        previousTags = null;
        renderTags();
        updateCopyRow();
        return;
      }
      startGeneration(response.url, response.coords, response.location, tab.id);
    });

  } catch (e) {
    setStatus("Something went wrong: " + e.message, "error");
  }
});
