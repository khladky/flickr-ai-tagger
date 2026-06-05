chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "FILL_TAGS") {
    fillTags(msg.tags).then(result => sendResponse(result)).catch(e => sendResponse({ error: e.message }));
    return true; // async
  }
  if (msg.type !== "GET_PHOTO_URL") return;

  const existingTags = Array.from(document.querySelectorAll('a.tag-text'))
    .map(a => a.textContent.trim().toLowerCase())
    .filter(t => t.length > 0);

  const locationEl = document.querySelector('a.location-name-link');
  const location = locationEl ? locationEl.textContent.trim() : null;

  const og = document.querySelector('meta[property="og:image"]');
  if (og && og.content) {
    sendResponse({ url: og.content, existingTags, location });
    return;
  }

  const imgs = Array.from(document.querySelectorAll('img'))
    .filter(i => i.src.includes('staticflickr.com') && i.naturalWidth > 200)
    .sort((a, b) => b.naturalWidth - a.naturalWidth);

  if (imgs.length) {
    sendResponse({ url: imgs[0].src, existingTags, location });
    return;
  }

  sendResponse({ error: "Could not find photo on this page." });
});

async function fillTags(tags) {
  // Click "Edit tags" to open the panel
  const editBtn = document.querySelector('a.show-add-tags');
  if (!editBtn) return { error: "Could not find Edit tags button" };
  editBtn.click();

  // Wait for input to appear
  const input = await waitFor('input.tags-selection-search', 3000);
  if (!input) return { error: "Tag input did not appear" };

  // Focus and set value
  input.focus();
  input.value = tags;
  // Trigger input event so Flickr's JS picks up the value
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true }));
  input.dispatchEvent(new KeyboardEvent("keyup",  { key: "Enter", keyCode: 13, bubbles: true }));

  // Wait briefly then click Done
  await new Promise(r => setTimeout(r, 3000));
  const doneBtn = document.querySelector('span.confirm-text');
  if (doneBtn) doneBtn.click();

  // Scroll to the tags section so user can see the result
  await new Promise(r => setTimeout(r, 500));
  const tagSection = document.querySelector('.tags-section, .tag-text, a.tag-text');
  if (tagSection) {
    tagSection.scrollIntoView({ behavior: "smooth", block: "center" });
  }

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
