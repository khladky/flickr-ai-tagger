chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "GET_PHOTO_URL") {
    handleGetPhotoUrl(sendResponse);
    return true; // async
  }
  if (msg.type === "FILL_TAGS") {
    fillTags(msg.tags).then(result => sendResponse(result)).catch(e => sendResponse({ error: e.message }));
    return true;
  }
  if (msg.type === "FILL_TITLE_DESC") {
    fillTitleDesc(msg.title, msg.description, msg.titleMode, msg.descMode).then(result => sendResponse(result)).catch(e => sendResponse({ error: e.message }));
    return true;
  }
  if (msg.type === "NAVIGATE") {
    const key = msg.direction === "prev" ? "ArrowLeft" : "ArrowRight";
    const code = msg.direction === "prev" ? "ArrowLeft" : "ArrowRight";
    const keyCode = msg.direction === "prev" ? 37 : 39;
    const evt = new KeyboardEvent("keydown", {
      key, code, keyCode, which: keyCode, bubbles: true, cancelable: true
    });
    document.dispatchEvent(evt);
    sendResponse({ ok: true });
    return false;
  }
  return false;
});

async function handleGetPhotoUrl(sendResponse) {

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

  // Read EXIF data — wait for DOM to be ready if needed
  const exif = {};

  function waitForEl(selector, timeout = 3000) {
    const el = document.querySelector(selector);
    if (el) return Promise.resolve(el);
    return new Promise(resolve => {
      const observer = new MutationObserver(() => {
        const found = document.querySelector(selector);
        if (found) { observer.disconnect(); resolve(found); }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => { observer.disconnect(); resolve(null); }, timeout);
    });
  }

  // Wait for camera element — may be a link or plain text
  await waitForEl('div.exif-camera-name');
  const cameraLink = document.querySelector('div.exif-camera-name a');
  if (cameraLink) {
    // Extract clean make/model from URL e.g. /cameras/panasonic/dc-g9/
    const urlMatch = (cameraLink.getAttribute('href') || '').match(/\/cameras\/([^/]+)\/([^/]+)\//);
    if (urlMatch) {
      exif.camera = (urlMatch[1] + '-' + urlMatch[2]).replace(/_/g, '-').toLowerCase();
    } else {
      const cam = cameraLink.textContent.trim();
      if (cam) exif.camera = cam;
    }
  } else {
    const cameraEl = document.querySelector('div.exif-camera-name');
    if (cameraEl) {
      const cam = cameraEl.textContent.trim();
      if (cam) exif.camera = cam;
    }
  }

  // Lens string — visible on page (fallback if no extended EXIF lens model)
  const lensStringEl = document.querySelector('div.lens-string');
  if (lensStringEl) {
    const ls = lensStringEl.textContent.trim();
    if (ls && ls !== 'N/A') exif.lensString = ls;
  }

  // Aperture, focal length, ISO, shutter speed
  const apertureEl = document.querySelector('li.c-charm-item-aperture span');
  if (apertureEl) exif.aperture = apertureEl.textContent.trim();

  const focalEl = document.querySelector('li.c-charm-item-focal-length span');
  if (focalEl) exif.focalLength = focalEl.textContent.trim();

  const isoEl = document.querySelector('li.c-charm-item-iso span');
  if (isoEl) exif.iso = isoEl.textContent.trim();

  const shutterEl = document.querySelector('li.c-charm-item-exposure-time span');
  if (shutterEl) exif.shutter = shutterEl.textContent.trim();

  // Extended EXIF fields — already in DOM, just hidden
  document.querySelectorAll('li.extended-exif-item').forEach(li => {
    const name = li.querySelector('span.exif-name')?.textContent.replace(' - ', '').trim();
    const value = li.querySelector('span.exif-value')?.textContent.trim();
    if (!name || !value || value === 'N/A' || value === '0') return;
    if (name === 'Focal Length (35mm format)' && !exif.focalLength35) exif.focalLength35 = value;
    // Prefer Lens Model over Lens Info
    if (name === 'Lens Model' && !exif.lensModelFull) exif.lensModelFull = value;
    if (name === 'Lens Info' && !exif.lensInfo) exif.lensInfo = value;
  });
  // Prefer Lens Model over Lens Info over lens-string
  exif.lensModel = exif.lensModelFull || exif.lensInfo || exif.lensString || null;
  delete exif.lensModelFull;
  delete exif.lensInfo;
  delete exif.lensString;

  // Validate focal length — reject obviously wrong values (e.g. 0mm)
  if (exif.focalLength && exif.focalLength.replace(/[^0-9.]/g, '') === '0') delete exif.focalLength;
  if (exif.focalLength35 && exif.focalLength35.replace(/[^0-9.]/g, '') === '0') delete exif.focalLength35;

  const og = document.querySelector('meta[property="og:image"]');
  if (og && og.content) {
    sendResponse({ url: og.content, existingTags, location, coords, exif });
    return;
  }

  const imgs = Array.from(document.querySelectorAll('img'))
    .filter(i => i.src.includes('staticflickr.com') && i.naturalWidth > 200)
    .sort((a, b) => b.naturalWidth - a.naturalWidth);

  if (imgs.length) {
    sendResponse({ url: imgs[0].src, existingTags, location, coords, exif });
    return;
  }

  sendResponse({ error: "Could not find photo on this page." });
}

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

async function fillTitleDesc(title, description, titleMode, descMode) {
  if (titleMode === "skip" && descMode === "skip") {
    return { error: "Both title and description set to unchanged — nothing to send" };
  }

  // Click the title to activate the edit form
  const titleDisplay = document.querySelector('h1.photo-title.editable');
  if (!titleDisplay) return { error: "Could not find title element" };
  titleDisplay.click();

  const titleInput = await waitFor('input.edit-photo-title', 3000);
  if (!titleInput) return { error: "Title input did not appear" };

  if (title && titleMode !== "skip") {
    let newTitle = title;
    if (titleMode === "append" && titleInput.value.trim()) {
      newTitle = titleInput.value.trim() + " — " + title;
    }
    titleInput.focus();
    titleInput.value = newTitle;
    titleInput.dispatchEvent(new Event("input", { bubbles: true }));
  }

  if (description && descMode !== "skip") {
    const descInput = document.querySelector('textarea.edit-photo-desc');
    if (descInput) {
      let newDesc = description;
      if (descMode === "append" && descInput.value.trim()) {
        newDesc = descInput.value.trim() + "\n\n" + description;
      }
      descInput.focus();
      descInput.value = newDesc;
      descInput.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  await new Promise(r => setTimeout(r, 300));
  const doneBtn = document.querySelector('button.done-editing-title-desc');
  if (doneBtn) doneBtn.click();

  await new Promise(r => setTimeout(r, 1000));
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
