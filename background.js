const extAPI = typeof browser !== 'undefined' ? browser : chrome;

extAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'start_downloads') {
    processBackgroundDownloads(message);
    sendResponse({ status: "started" });
  } else if (message.action === 'download_single_item') {
    performActualDownload(message.url, message.filename)
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true; // async response
  }
});

function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i += 10000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + 10000, bytes.byteLength)));
  }
  return btoa(binary);
}

async function processBackgroundDownloads(msg) {
  const { items, folderName, sourceTitle, sourceUrl } = msg;
  let logContent = msg.logContent;
  const finalItems = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const startTime = Date.now();
    let finalFilename = item.filename;

    if (finalFilename.endsWith('.unknown') && !item.url.startsWith('data:')) {
      finalFilename = finalFilename.replace(/\.unknown$/, '');
      try {
        const headRes = await fetch(item.url, { method: 'HEAD', cache: 'force-cache' });
        if (headRes.ok) {
          const cType = headRes.headers.get('content-type');
          if (cType && cType.startsWith('image/')) {
            let realExt = cType.split('/')[1].split(';')[0].toLowerCase();
            if (realExt === 'jpeg') realExt = 'jpg';
            if (realExt === 'svg+xml') realExt = 'svg';
            finalFilename += `.${realExt}`;
          } else {
            finalFilename += '.jpg';
          }
        } else {
          finalFilename += '.jpg';
        }
      } catch (e) {
        finalFilename += '.jpg';
      }
    } else if (finalFilename.endsWith('.unknown') && item.url.startsWith('data:')) {
      finalFilename = finalFilename.replace(/\.unknown$/, '.jpg');
    }

    try {
      await performActualDownload(item.url, finalFilename);
      finalItems.push({ filename: finalFilename, url: item.url });
      
      // Update UI in real-time
      extAPI.runtime.sendMessage({ 
        action: 'job_update', 
        url: item.url, 
        status: 'success', 
        index: i,
        total: items.length 
      }).catch(() => {}); // ignore errors if popup closed
    } catch (err) {
      console.error(`Failed to download ${finalFilename}`, err);
      // Update UI for failure
      extAPI.runtime.sendMessage({ 
        action: 'job_update', 
        url: item.url, 
        status: 'failed', 
        index: i, 
        total: items.length 
      }).catch(() => {});
    }

    if (i < items.length - 1) {
      const elapsed = Date.now() - startTime;
      if (elapsed < 100) {
        await new Promise(r => setTimeout(r, 100 - elapsed));
      }
    }
  }

  function generateHtmlGallery(items, pageTitle, pageUrl) {
    const itemsHtml = items.map(item => {
      const nameOnly = item.filename.split('/').pop();
      const safeSrc = encodeURIComponent(nameOnly);
      return `
        <div class="item">
          <div class="img-container">
            <img src="${safeSrc}" alt="${nameOnly}">
          </div>
          <div class="meta">
            <a class="url" href="${item.url.startsWith('data:') ? '#' : item.url}" target="_blank">
              ${nameOnly}
            </a>
          </div>
        </div>
      `;
    }).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Collection: ${pageTitle || 'Export'}</title>
  <style>
    :root { --bg: #0f172a; --card: #1e293b; --text: #f8fafc; --muted: #94a3b8; --accent: #3b82f6; }
    body { background-color: var(--bg); color: var(--text); font-family: system-ui, -apple-system, sans-serif; padding: 2rem; margin: 0; }
    header { margin-bottom: 2rem; border-bottom: 1px solid var(--muted); padding-bottom: 1rem; }
    h1 { margin: 0 0 0.5rem 0; font-size: 1.5rem; }
    .source { color: var(--muted); font-size: 0.875rem; word-break: break-all; margin-bottom: 0.5rem; }
    .gallery { display: flex; flex-wrap: wrap; gap: 4px; justify-content: flex-start; align-items: stretch; }
    .item { position: relative; height: 400px; max-width: 640px; flex: 0 0 auto; background: #000; border-radius: 8px; overflow: hidden; border: 1px solid rgba(255,255,255,0.05); display: block; box-sizing: border-box; }
    .img-container { height: 100%; width: 100%; overflow: hidden; }
    img { width: 100%; height: 100%; display: block; object-fit: contain; transition: transform 0.4s cubic-bezier(0.4, 0, 0.2, 1); }
    .item:hover img { transform: scale(1.08); }
    .meta { 
      position: absolute; 
      bottom: 0; left: 0; right: 0; 
      padding: 1.5rem 0.5rem 0.5rem; 
      background: linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.5) 70%, transparent 100%);
      opacity: 0;
      transition: opacity 0.3s ease;
      display: flex; justify-content: center;
    }
    .item:hover .meta { opacity: 1; }
    .url { 
      color: #fff; 
      font-weight: 600; 
      font-size: 0.8rem; 
      text-decoration: none; 
      text-shadow: 0 1px 2px rgba(0,0,0,0.8);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      text-align: center;
      max-width: 90%;
    }
    .url:hover { color: var(--accent); text-decoration: underline; }
    footer { margin-top: 4rem; text-align: center; color: var(--muted); font-size: 0.8rem; }
  </style>
</head>
<body>
  <header>
    <h1>${pageTitle || 'Image Collection'}</h1>
    <div class="source">Source: <a href="${pageUrl || '#'}" style="color:inherit">${pageUrl || 'Local'}</a></div>
    <div class="source">Captured on: ${new Date().toLocaleString()}</div>
  </header>
  <div class="gallery">${itemsHtml}</div>
  <footer>Generated by Image Collector</footer>
  <script>
    const BASE_H = 400, MAX_RATIO = 1.6, GAP = 4;
    let loaded = 0;
    const allImgs = document.querySelectorAll('.gallery img');
    const total = allImgs.length;

    function justify() {
      const gallery = document.querySelector('.gallery');
      const W = gallery.clientWidth;
      const items = Array.from(gallery.children);

      const ratios = items.map(item => {
        const img = item.querySelector('img');
        if (!img || !img.naturalWidth) return 1;
        return Math.min(img.naturalWidth / img.naturalHeight, MAX_RATIO);
      });

      items.forEach((item, i) => {
        const img = item.querySelector('img');
        if (!img || !img.naturalWidth) return;
        if (img.naturalWidth / img.naturalHeight > MAX_RATIO) img.style.objectFit = 'cover';
      });

      let row = [], rowStart = 0;
      for (let i = 0; i < items.length; i++) {
        row.push(items[i]);
        const rowRatios = ratios.slice(rowStart, i + 1);
        const totalRatio = rowRatios.reduce((s, r) => s + r, 0);
        const gaps = (row.length - 1) * GAP;
        const rowH = (W - gaps) / totalRatio;

        if (rowH <= BASE_H || i === items.length - 1) {
          const h = (i === items.length - 1 && rowH > BASE_H) ? BASE_H : rowH;
          let usedW = 0;
          row.forEach((item, j) => {
            item.style.height = Math.floor(h) + 'px';
            if (j < row.length - 1) {
              const w = Math.floor(h * rowRatios[j]);
              item.style.width = w + 'px';
              usedW += w + GAP;
            } else {
              item.style.width = (i === items.length - 1 && rowH > BASE_H)
                ? Math.floor(h * rowRatios[j]) + 'px'
                : (W - usedW) + 'px';
            }
          });
          row = []; rowStart = i + 1;
        }
      }
    }

    function onImgReady() {
      loaded++;
      if (loaded >= total) { justify(); window.addEventListener('resize', justify); }
    }
    allImgs.forEach(img => {
      img.onload = onImgReady;
      img.onerror = onImgReady;
      if (img.complete) onImgReady();
    });
  </script>
</body>
</html>`;
  }

  async function saveTextFile(folder, fileName, content, type) {
    if (!content) return;
    try {
      const isFirefox = typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('firefox');
      if (isFirefox) {
        const blob = new Blob([content], { type: type });
        const objUrl = URL.createObjectURL(blob);
        await extAPI.downloads.download({ url: objUrl, filename: `${folder}/${fileName}`, saveAs: false });
        setTimeout(() => URL.revokeObjectURL(objUrl), 10000);
      } else {
        const b64 = utf8ToBase64(content);
        const dataUrl = `data:${type};charset=utf-8;base64,${b64}`;
        await extAPI.downloads.download({ url: dataUrl, filename: `${folder}/${fileName}`, saveAs: false });
      }
    } catch (err) {
      console.error(`Failed to save ${fileName}`, err);
    }
  }

  // Build and save the HTML gallery locally using the final correctly-named items
  const htmlGallery = generateHtmlGallery(finalItems, sourceTitle, sourceUrl);
  await saveTextFile(folderName, 'index.html', htmlGallery, 'text/html');
}

/**
 * Shared logic to perform a download across all browsers and URI types
 */
async function performActualDownload(url, filename) {
  if (url.startsWith('data:')) {
    // Chrome MV3 Service Workers cannot directly download data: URIs in many cases.
    // We use an offscreen document (which has a DOM/window) to proxy the download.
    const isChrome = typeof chrome !== 'undefined' && !!chrome.offscreen;
    
    if (isChrome && url.startsWith('data:')) {
      // Chrome MV3 doesn't need "offscreen" if we use the Active Tab context for fallback!
      try {
        // Try direct first (works for smaller/cleaner data URIs)
        return await extAPI.downloads.download({
          url: url,
          filename: filename,
          saveAs: false
        });
      } catch (err) {
        console.warn("Direct background download failed for data: URI, attempting tab-injection fallback...");
        
        const [tab] = await extAPI.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.id) {
           await extAPI.scripting.executeScript({
              target: { tabId: tab.id },
              func: (dataUrl, fileName) => {
                 const link = document.createElement('a');
                 link.href = dataUrl;
                 link.download = fileName.split('/').pop();
                 document.body.appendChild(link);
                 link.click();
                 document.body.removeChild(link);
              },
              args: [url, filename]
           });
           return { success: true, warning: 'Subfolder not supported for some embedded images in Chrome' };
        }
        throw err;
      }
    } else {
      try {
        const resp = await fetch(url);
        const blob = await resp.blob();
        const blobUrl = URL.createObjectURL(blob);
        
        const dId = await extAPI.downloads.download({
          url: blobUrl,
          filename: filename,
          saveAs: false
        });

        setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
        return dId;
      } catch (blobErr) {
        return await extAPI.downloads.download({
          url: url,
          filename: filename,
          saveAs: false
        });
      }
    }
  } else {
    return await extAPI.downloads.download({
      url: url,
      filename: filename,
      saveAs: false
    });
  }
}
