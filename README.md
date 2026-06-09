# Flickr AI Tagger — Gemini

A Chrome extension that uses Google's Gemini AI to automatically suggest tags for your Flickr photos directly from the photo page. It identifies the scene, objects, people, and location — combining GPS reverse geocoding and Flickr location data for accurate place tagging — and lets you review and edit the tags before applying them to Flickr automatically.

<img src="screenshot.png" width="800">

## Requirements

- Google Chrome
- A Google AI Studio API key (see below)

## Downloading and installing the extension

On the GitHub repository page, click the green **Code** button near the top right, then select **Download ZIP**. Extract the zip to a folder on your computer — this folder needs to stay in place permanently as Chrome will load the extension directly from it.

1. Open Chrome and go to `chrome://extensions`
2. Turn on **Developer mode** (toggle in the top right)
4. Click **Load unpacked** and select the extension folder

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
4. Click **Generate tags**
5. Review the suggested tags, edit as needed, then click **Copy tags to clipboard**

The popup can be closed while tags are generating — a blue badge appears on the icon while generating and turns green when done. Reopen the popup to see the results.

## Reviewing and editing tags

Tags are colour coded:

- **Blue** — already on this photo in Flickr. Shown for reference, not included in the copy.
- **Yellow** — freshly suggested by Gemini. Remove any you don't want by clicking **×**.
- **Purple** — tags you have added manually.
- **Purple (labelled "Added from EXIF")** — tags automatically read from the photo's camera data (see below).
- **Grey italic** — a tag currently being edited (see below).

**To add a tag** — type in the box at the bottom of the tag panel and press Enter or click **Add**. Spaces are converted to hyphens automatically. If the entered tag already exists — either already on Flickr or in the Gemini suggestions — it will not be added again.

**To edit a tag** — Alt+click it. It turns grey in place and its text appears in the add box for editing. Press Enter to apply the edit, press Escape or click the **×** on the grey tag to cancel and restore the original.

**To regenerate tags for current image** — click **Regenerate tags** to discard the current suggestions and get a fresh set from Gemini. Any tags you added manually are preserved. If the new set is worse than the previous one, Alt+click the Regenerate button to go back to what you had before.

## Auto-fill

Tick **Auto-fill Flickr tag field on copy** to have the extension open Flickr's tag editor, paste the tags, and submit them automatically. The popup closes once done and the page scrolls to show the updated tags.

Once the popup has closed after auto-filling, the left and right arrow keys can be used to navigate to the previous or next photo in your Flickr stream.

## Google Lens

The photo in the popup is clickable — clicking it opens Google Lens in a background browser tab. Google Lens often identifies specific landmarks, monuments and places that Gemini misses, making it a useful supplement to the generated tags. Selecting **AI Mode** in Google Lens gives the most detailed analysis.

When done, switch back to the Flickr page tab and reopen the popup — it will be exactly as you left it with all tags intact. Any additional information found in Lens can be typed into the add tag box.

## Location tagging

If your photo has GPS coordinates on Flickr, the extension uses two sources to produce accurate location tags:

- **OpenStreetMap Nominatim** — reverse geocodes the GPS coordinates to get suburb, city, county, region and country.
- **Flickr location data** — the place name Flickr has assigned to the photo, used as a cross-reference.

Both sources are passed to Gemini which generates the most accurate location tags it can, from specific neighbourhood level down to country.

## Camera and lens data (EXIF)

Tick **Include camera and lens data as tags** to automatically add technical tags from the photo's embedded EXIF data. These appear immediately when the popup opens, without needing a Gemini call, under the label "Added from EXIF". Fields included where available:

- Camera make and model (e.g. `panasonic-dmc-tz100`)
- Lens model (e.g. `leica-dc-vario-elmarit-9.1-91mm`)
- Focal length in 35mm equivalent (e.g. `25mm`)
- Aperture (e.g. `f2.8`)
- Shutter speed (e.g. `1/500s`)
- ISO (e.g. `iso-125`)
- `long-exposure` — added automatically if shutter speed is 1 second or longer

Individual EXIF tags can be removed by clicking **×** on them. If the photo has no EXIF data, or the owner has hidden it, a brief message will say "No camera data available for this photo."

## Keyboard shortcut

The extension can be opened with **Alt+F** when on a Flickr photo page. This can be changed at `chrome://extensions/shortcuts`.

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
