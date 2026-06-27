const DEFAULT_PROMPT = "Generate a short Flickr photo title and a three to four sentence description of the main subject of the image only. Use simple language. Omit any location information.";

const textarea = document.getElementById("prompt-text");
const saveBtn = document.getElementById("save-btn");
const resetBtn = document.getElementById("reset-btn");
const status = document.getElementById("status");

// Load saved prompt — show default if none saved
chrome.storage.local.get("customPrompt", ({ customPrompt }) => {
  textarea.value = customPrompt || DEFAULT_PROMPT;
});

// Save
saveBtn.addEventListener("click", () => {
  chrome.storage.local.set({ customPrompt: textarea.value.trim() }, () => {
    status.textContent = "Saved.";
    setTimeout(() => window.close(), 2000);
  });
});

// Reset to default
resetBtn.addEventListener("click", () => {
  chrome.storage.local.remove("customPrompt", () => {
    textarea.value = DEFAULT_PROMPT;
    status.textContent = "Reset to default.";
    setTimeout(() => { status.textContent = ""; }, 2000);
  });
});

// Presets
document.querySelectorAll(".preset").forEach(btn => {
  btn.addEventListener("click", () => {
    textarea.value = btn.dataset.prompt;
    textarea.focus();
  });
});
