chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "FILL_TAGS") {
    fillTags(msg.tags).then(result => sendResponse(result)).catch(e => sendResponse({ error: e.message }));
    return true;
  }
  if (msg.type !== "GET_PHOTO_URL") return;

  const existingTags = Array.from(document.querySelectorAll('a.tag-text'))
    .map(a => a.textContent.trim().toLowerCase())
    .filter(t => t.length > 0);

  const locationEl = document.querySelector('a.location-name-link');
  const location = locationEl ? locationEl.textContent.trim() : null;

  // Extract GPS coordinates from location link href
  let coords = null;
  if (locationEl) {
    const href = locationEl.getAttribute('href') || '';
    const latMatch = href.match(/lat=([-0-9.]+)/);
    const lonMatch = href.match(/lon=([-0-9.]+)/);
    if (latMatch && lonMatch) {
      coords = { lat: latMatch[1], lon: lonMatch[1] };
    }
  }

  const og = document.querySelector('meta[property="og:image"]');
  if (og && og.content) {
    sendResponse({ url: og.content, existingTags, location, coords });
    return;
  }

  const imgs = Array.from(document.querySelectorAll('img'))
    .filter(i => i.src.includes('staticflickr.com') && i.naturalWidth > 200)
    .sort((a, b) => b.naturalWidth - a.naturalWidth);

  if (imgs.length) {
    sendResponse({ url: imgs[0].src, existingTags, location, coords });
    return;
  }

  sendResponse({ error: "Could not find photo on this page." });
});

async function fillTags(tags) {
  const editBtn = document.querySelector('a.show-add-tags');
  if (!editBtn) return { error: "Could not find Edit tags button" };
  editBtn.click();

  const input = await waitFor('input.tags-selection-search', 3000);
  if (!input) return { error: "Tag input did not appear" };

  input.focus();
  input.value = tags;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true }));
  input.dispatchEvent(new KeyboardEvent("keyup",  { key: "Enter", keyCode: 13, bubbles: true }));

  await new Promise(r => setTimeout(r, 3000));
  const doneBtn = document.querySelector('span.confirm-text');
  if (doneBtn) doneBtn.click();

  await new Promise(r => setTimeout(r, 500));
  const tagSection = document.querySelector('.tags-section, .tag-text, a.tag-text');
  if (tagSection) tagSection.scrollIntoView({ behavior: "smooth", block: "center" });

  return { ok: true };
}

function waitFor(selector, timeout) {
  return new Promise(resolve => {
    const el = document.querySelector(selector);
    if (el) { resolve(el); return; }
    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) { observer.disconnect(); resolve(el); }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => { observer.disconnect(); resolve(null); }, timeout);
  });
}
