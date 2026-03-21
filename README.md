# Image Collector

A powerful, cross-browser extension natively supporting Google Chrome and Mozilla Firefox that effortlessly extracts, filters, curates, and downloads maximum-resolution images from any modern webpage.

## 🚀 Key Features

* **Advanced Resolution Extraction**: Intelligently parses modern `<picture>` and `srcset` tags to bypass the low-res images currently rendered by your browser and aggressively hunt down the absolute maximum resolution assets mapped from the server's source list.
* **Smart Drag-and-Drop Gallery**: Hover, select, and seamlessly drag images around your grid to visually curate your export list exactly how you want it.
* **Sequential Renaming**: Easily prefix exports with clean tracking numbers (`001_image.jpg`, `002.png`) that perfectly reflect your customized drag-and-drop gallery order.
* **Precision Filtering**:
  * **File Type Checkboxes**: Instantly toggle combinations of explicit formats (*JPG, PNG, GIF, WEBP, SVG, Other*).
  * **Network-Assisted Type Resolution**: Identify headless images missing active `.jpg` or `.png` paths by seamlessly executing lightweight `HEAD` requests to verify the precise `Content-Type` header directly from the server.
  * **Dimension Constraints**: Set strict minimum scaling bounds (width `x` height). For responsive 4K images hidden deep in HTML5 source tags, the extension mathematically derives the invisible DOM height via precise aspect ratios to bypass your filters correctly.
  * **Zero-Dimension Rejection**: Automatically purges invisible CSS spacer images, 1x1 tracking pixels, and tiny UI micro-icons from polluting your gallery.
* **Throttled Paced Engines**: Both the background network analyzer and the massive bulk downloader are strictly paced asynchronously (max 5 network operations per second) to ensure your active browser tab never freezes or crashes, and you don't trip any server-side Cloudflare DDoS firewalls during your pulls.
* **Progressive UI Feedback**: Clear, live-action success badges (`✓`) and dynamic button label reporting (`Downloading 14/80...`) so you are never left guessing how far through a massive queue you are currently at.

## ⚙️ Installation

### Google Chrome
1. Navigate to your address bar and enter: `chrome://extensions/`
2. Enable **Developer mode** in the top right corner toggle.
3. Click the **Load unpacked** button.
4. Select this current `/media-collector` folder.

### Mozilla Firefox
1. Navigate to your address bar and enter: `about:debugging#/runtime/this-firefox`
2. Click the **Load Temporary Add-on...** button.
3. Select the `manifest.json` file inside this `/media-collector` folder.
