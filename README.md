# Flickr AI Tagger — Gemini

A Chrome extension that uses Google's Gemini AI to automatically suggest tags, a title and a description for your Flickr photos directly from the photo page. It identifies the scene, objects, people, and location — combining GPS reverse geocoding and Flickr location data for accurate place tagging — and lets you review and edit everything before sending it to Flickr.

<img src="screenshot.png" width="800">

## Requirements

- Google Chrome
- A Google AI Studio API key (see below)

## Downloading and installing the extension

On the GitHub repository page, click the green **Code** button near the top right, then select **Download ZIP**. Extract the zip to a folder on your computer — this folder needs to stay in place permanently as Chrome will load the extension directly from it.

1. Open Chrome and go to `chrome://extensions`
2. Turn on **Developer mode** (toggle in the top right)
3. Click **Load unpacked** and select the extension folder

## Updating to a new version

When a new version is released, download the ZIP again from GitHub, extract it, and copy the new files into your existing extension folder, replacing the old ones. Then go to `chrome://extensions`, find the Flickr AI Tagger card, and click the circular arrow icon (↻) in the bottom left corner of the card to reload it. Your API key and settings are stored separately and will not be affected.

## Getting an API key

1. Go to [aistudio.google.com](https://aistudio.google.com) and sign in with a Google account
2. Click **Get API key** and create a new key
3. Copy the key — you will need it the first time you open the extension

The free tier allows a small number of requests per day. For regular use, add billing at [aistudio.google.com](https://aistudio.google.com) — costs are very small (fractions of a penny per photo) and a small amount of credit (£10 minimum) goes a very long way.

## Basic usage

1. Open any Flickr photo page
2. Click the extension icon in the toolbar, or press **Alt+F**
3. Paste your Google AI Studio API key when prompted (first time only)
4. Tick whichever of the three options at the top you want (see below)
5. Click **Generate**
6. Review and edit the results, then send them to Flickr

The popup can be closed while Gemini is working — a blue badge appears on the icon while generating and turns green when done. Reopen the popup to see the results, which are cached and will not need regenerating.

## What gets generated

Three independent options appear at the top of the popup:

- **Generate Flickr tags** — ticked by default. Asks Gemini to suggest tags describing the scene, objects, people, activities and location.
- **Include camera and lens data as tags** — reads the photo's embedded EXIF data and adds technical tags. No Gemini call needed, and this can be ticked or unticked at any time — the tags appear or disappear immediately, no need to reload the page.
- **Generate title & description** — asks Gemini for a short title and a few sentences of description for the photo. This is a separate API call from tag generation, so it doubles the number of Gemini requests used per photo when ticked. In practice the cost difference is negligible — still a small fraction of a penny per photo.

Untick all of "Generate Flickr tags" and "Generate title & description" and the Generate button will show a warning rather than doing nothing silently — there has to be something for Gemini to actually do.

## Reviewing and editing tags

Tags are colour coded:

- **Blue** — already on this photo in Flickr. Shown for reference, not included in the copy. Tags already on Flickr can only be removed via the photo's own tag editor on the Flickr photo page, not through this extension.
- **Yellow** — freshly suggested by Gemini. Remove any you don't want by clicking **×**.
- **Purple** — tags you have added manually.
- **Purple (labelled "Added from EXIF")** — tags automatically read from the photo's camera data.
- **Grey italic** — a tag currently being edited.

**To add a tag** — type in the box at the bottom of the tag panel and press Enter or click **Add**. Spaces are converted to hyphens automatically. If the entered tag already exists — either already on Flickr or in the Gemini suggestions — it will not be added again, and the existing tag will flash red to show you where it is.

**To edit a tag** — Alt+click it. It turns grey in place and its text appears in the add box for editing. Press Enter to apply the edit, press Escape or click the **×** on the grey tag to cancel and restore the original.

**To regenerate tags for current image** — click **Generate** again to discard the current suggestions and get a fresh set from Gemini. Any tags you added manually are preserved. If the new set is worse than the previous one, Alt+click the Generate button to go back to what you had before.

## Sending tags to Flickr

A small 📋 button next to the tag listing box copies the tag list to your clipboard at any time.

A **Send tags to Flickr** button also appears — clicking it opens Flickr's tag editor, pastes the tags, and submits them automatically. Once sent successfully, those tags move into the blue "Already on Flickr" section in the popup, reflecting what is now actually on the photo.

The left and right arrow keys can be used at any time while the popup is open to navigate to the previous or next photo in your Flickr stream — pressing one closes the popup and moves to the next photo automatically. This is disabled while typing in a tag, title or description field so the arrow keys move the cursor as normal.

**Note:** Once tags have been sent to Flickr they can only be removed via the photo's own tag editor on the Flickr photo page, not through this extension.

## Title and description

If "Generate title & description" was ticked, a title box and a description box will appear once Gemini has finished. Both are directly editable — click in and change the wording before sending if you are unhappy with the quaint AI language.

Two small 📋 buttons let you copy the title or description individually.

For each of the title and the description, two checkboxes control what happens when you send to Flickr:

- **Append** (default) — adds the new text after whatever is already there.
- **Replace** — overwrites the existing title or description entirely.

Leave both checkboxes for a field unticked to leave that field untouched when sending. Ticking one automatically unticks the other for that field. Your choice is remembered between photos.

Click **Send title & description to Flickr** to apply the changes. The popup stays open afterwards so the title or description can be edited further and sent again — use the arrow keys when you are ready to move to the next photo.

Occasionally Gemini does not return a usable title or description. If this happens, click **Regenerate** to try once more.

### Customising the style with a prompt file

By default, the title and description are written in a plain, factual style. To change this — for example to make them funnier, more poetic, more technical, or written in a different language — create a plain text file named exactly `user_gdq.txt` and place it in the same folder as `manifest.json`.

Whatever single instruction you write in that file replaces the opening instruction Gemini is given. The extension always appends its own fixed rules afterwards (correct output format, avoiding hedging language, no raw location data dumps), so the result stays reliable regardless of what you write — only the tone and style are under your control.

An example file, `user_gdq.example.txt`, is included in the repository with several ready-to-use presets — sarcastic, dry technical, poetic, written as a five-year-old would describe it, and a different-language example. Copy the line you want into a new file named `user_gdq.txt` to activate it. This example file is never loaded automatically; only a file named exactly `user_gdq.txt` is used.

**Turning the custom prompt on or off:** once `user_gdq.txt` exists, a checkbox labelled **"Use custom prompt from user_gdq.txt"** appears underneath "Generate title & description" in the popup. The first time it appears it is ticked automatically if a non-empty `user_gdq.txt` file is found, otherwise left unticked. After that, your choice is remembered — tick or untick it any time to switch between your custom style and the default, without needing to touch the file itself. The `user_gdq.txt` file is only read at all when the checkbox is ticked.

When the custom prompt is actually used, a brief warning appears in the popup confirming it, so you always know which mode is active.

## Google Lens

The photo in the popup is clickable — clicking it opens Google Lens in a background browser tab. Google Lens often identifies specific landmarks, monuments and places that Gemini misses, making it a useful supplement to the generated tags. Selecting **AI Mode** in Google Lens gives the most detailed analysis.

When done, switch back to the Flickr page tab and reopen the popup — it will be exactly as you left it with all tags, title and description intact.

## Location tagging

If your photo has GPS coordinates on Flickr, the extension uses two sources to produce accurate location tags:

- **OpenStreetMap Nominatim** — reverse geocodes the GPS coordinates to get suburb, city, county, region and country.
- **Flickr location data** — the place name Flickr has assigned to the photo, used as a cross-reference.

Both sources are passed to Gemini, which generates the most accurate location tags it can, from specific neighbourhood level down to country.

## Camera and lens data (EXIF)

Tick **Include camera and lens data as tags** to automatically add technical tags from the photo's embedded EXIF data. Fields included where available:

- Camera make and model (e.g. `panasonic-dmc-tz100`)
- Lens model (e.g. `leica-dc-vario-elmarit-91-91mm`)
- Focal length in 35mm equivalent (e.g. `25mm`)
- Aperture (e.g. `f2.8`)
- Shutter speed (e.g. `1/500s`)
- ISO (e.g. `iso-125`)
- `long-exposure` — added automatically if shutter speed is 1 second or longer

All EXIF tags are formatted to work correctly with Flickr's search. Double-clicking any EXIF tag on the Flickr photo page will search for other photos with that camera, lens, aperture or shutter speed etc. tag.

Individual EXIF tags can be removed by clicking **×** on them before they are sent to Flickr. If the photo has no EXIF data, or the owner has hidden it, a brief message will say "No camera data available for this photo."

## Keyboard shortcut

The extension can be opened with **Alt+F** when on a Flickr photo page. This can be changed at `chrome://extensions/shortcuts`.

If your mouse has extra buttons, you can map one of them to **Alt+F** using free software such as [X-Mouse Button Control](https://www.highrez.co.uk/downloads/xmousebuttoncontrol.htm). This lets you open the extension with a single mouse button click. X-Mouse Button Control supports per-application profiles, so the mapping can be set to apply only when Chrome is active, leaving the button's normal behaviour unchanged in other applications.

## Firefox

The extension includes Firefox compatibility settings. Firefox support is experimental and has not been fully tested. If you try it and find issues, please raise them in the GitHub issues tab.

**Firefox installation:**
1. Go to `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on**
3. Select any file inside the extension folder

Note: Firefox temporary add-ons are removed when the browser closes.

## Notes

- The extension cannot tag photos with nudity — this is a restriction of the Gemini API.
- If tags from a previous session appear unexpectedly, use the **🗑 Clear cached tags** button.
- If the extension shows "Already generating", open the service worker console at `chrome://extensions` and run: `chrome.storage.local.get(null, data => { const toRemove = Object.keys(data).filter(k => k.includes('flickr.com')); chrome.storage.local.remove(toRemove); })`

## License

MIT
