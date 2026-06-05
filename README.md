# Flickr AI Tagger — Gemini

A Chrome extension that uses Google's Gemini AI to suggest tags for your Flickr photos. It reads the photo directly from the Flickr page, identifies the location and scene, and lets you review and edit the tags before sending them to Flickr automatically.

<img src="screenshot.png" width="400">

## Requirements

- Google Chrome
- A free Google AI Studio API key (see below)

## Installation

1. Download the extension folder and save it somewhere permanent on your computer — Chrome needs it to stay there.
2. Open Chrome and go to `chrome://extensions`
3. Turn on **Developer mode** (toggle in the top right)
4. Click **Load unpacked** and select the extension folder
5. The Flickr AI Tagger icon will appear in your Chrome toolbar

## Getting a free API key

1. Go to [aistudio.google.com](https://aistudio.google.com) and sign in with a Google account
2. Click **Get API key** and create a new key
3. Copy the key — you'll need it the first time you open the extension

## Usage

1. Open any Flickr photo page
2. Click the extension icon in the toolbar
3. Paste your API key when prompted (first time only)
4. Click **Generate tags** — the popup can be closed while it runs; a badge appears on the icon when done
5. Review the suggested tags — click **×** to remove any, type in the box to add your own
6. Click **Copy tags to clipboard** (or **Copy tags and send to Flickr** if Auto-fill is on)

To add tags manually, type in the box and press Enter or click **Add**. Tags are added one at a time — type multi-word tags normally with spaces (e.g. `blackpool tower`) and they will be converted to the correct hyphenated format automatically.

## Tag colours

- **Blue** — tags already on this photo in Flickr (read-only)
- **Yellow** — freshly suggested by Gemini
- **Purple** — tags you have added or kept from a previous generation

## Auto-fill

Tick **Auto-fill Flickr tag field on copy** to have the extension open Flickr's tag editor, paste the tags, and submit them automatically. The popup closes itself once done and the page scrolls to show the updated tags.

## Notes

- The free Gemini tier allows around 500 requests per day. For heavier use, add billing at [aistudio.google.com](https://aistudio.google.com) — costs are very small (fractions of a penny per photo).
- The extension cannot tag photos with nudity — this is a restriction of the Gemini API.
- If tags from a previous session appear unexpectedly, use the **🗑 Clear cached tags** button.
