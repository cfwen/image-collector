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

  // Chrome's download manager uses the browser's full Accept headers (including
  // image/webp), so CDNs may serve WebP even for URLs ending in .png.
  // Chrome then renames the file to match the actual Content-Type.
  // We detect this via a HEAD request and fix the filename before downloading,
  // so the saved file, the index.html link, and the actual bytes all agree.
  const isChrome = typeof browser === 'undefined'; // Firefox exposes `browser`, Chrome does not

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const startTime = Date.now();
    let finalFilename = item.filename;

    if (!item.url.startsWith('data:')) {
      // Always do a HEAD check for non-data URLs:
      //  - for .unknown: determine the real extension
      //  - for known extensions in Chrome: verify the server won't serve a
      //    different type (e.g. CDN transcodes PNG→WebP for Chrome requests)
      const isUnknown = finalFilename.endsWith('.unknown');
      if (isUnknown) {
        finalFilename = finalFilename.replace(/\.unknown$/, '');
      }

      try {
        const headRes = await fetch(item.url, { method: 'HEAD', cache: 'force-cache' });
        if (headRes.ok) {
          const cType = headRes.headers.get('content-type');
          if (cType && cType.startsWith('image/')) {
            let realExt = cType.split('/')[1].split(';')[0].toLowerCase();
            if (realExt === 'jpeg') realExt = 'jpg';
            if (realExt === 'svg+xml') realExt = 'svg';

            const currentExt = finalFilename.split('.').pop().toLowerCase();
            const knownExts = ['jpg', 'png', 'gif', 'webp', 'svg', 'avif', 'ico', 'bmp'];

            if (isUnknown) {
              // For unknown extensions, always apply the resolved type
              finalFilename += '.' + realExt;
            } else if (isChrome && currentExt !== realExt && knownExts.includes(realExt)) {
              // For Chrome: fix mismatched extensions so Chrome won't rename the file
              finalFilename = finalFilename.replace(/\.[^/.]+$/, '') + '.' + realExt;
            }
          } else if (isUnknown) {
            finalFilename += '.jpg';
          }
        } else if (isUnknown) {
          finalFilename += '.jpg';
        }
      } catch (e) {
        if (isUnknown) finalFilename += '.jpg';
      }
    } else if (item.url.startsWith('data:') && finalFilename.endsWith('.unknown')) {
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
            <span class="url">${nameOnly}</span>
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
    *, *::before, *::after { box-sizing: border-box; }
    body { background-color: var(--bg); color: var(--text); font-family: system-ui, -apple-system, sans-serif; padding: 2rem; margin: 0; }
    header { margin-bottom: 2rem; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 1rem; }
    h1 { margin: 0 0 0.5rem 0; font-size: 1.5rem; }
    .source { color: var(--muted); font-size: 0.875rem; word-break: break-all; margin-bottom: 0.5rem; }
    .gallery { display: flex; flex-wrap: wrap; gap: 4px; justify-content: flex-start; align-items: stretch; }
    .item {
      position: relative; height: 400px; max-width: 640px; flex: 0 0 auto;
      background: #000; border-radius: 8px; overflow: hidden;
      border: 1px solid rgba(255,255,255,0.05); display: block;
      cursor: pointer; transition: border-color 0.2s;
    }
    .item:hover { border-color: rgba(59,130,246,0.5); }
    .img-container { height: 100%; width: 100%; overflow: hidden; }
    .item img { width: 100%; height: 100%; display: block; object-fit: contain; transition: transform 0.4s cubic-bezier(0.4,0,0.2,1); }
    .item:hover img { transform: scale(1.06); }
    .meta {
      position: absolute; bottom: 0; left: 0; right: 0;
      padding: 1.5rem 0.75rem 0.6rem;
      background: linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.5) 70%, transparent 100%);
      opacity: 0; transition: opacity 0.3s ease; display: flex; justify-content: center;
    }
    .item:hover .meta { opacity: 1; }
    .url { color: #fff; font-weight: 600; font-size: 0.8rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: center; max-width: 90%; }
    footer { margin-top: 4rem; text-align: center; color: var(--muted); font-size: 0.8rem; }
    .review-btn-header {
      display: inline-flex; align-items: center; gap: 0.4rem;
      padding: 0.45rem 1.1rem; background: var(--accent); color: #fff;
      border: none; border-radius: 8px; font-size: 0.85rem; font-weight: 600;
      cursor: pointer; margin-top: 0.75rem; font-family: inherit;
      transition: background 0.2s, transform 0.15s;
    }
    .review-btn-header:hover { background: #2563eb; transform: translateY(-1px); }
    .review-btn-header:active { transform: translateY(1px); }

    /* Review Overlay */
    .review-overlay {
      display: none; position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
      background: rgba(0,0,0,0.96); z-index: 9999;
      color: #fff; font-family: system-ui, -apple-system, sans-serif;
    }
    .review-overlay.active { display: block; }
    .r-control-panel {
      position: absolute; top: 14px; right: 14px;
      display: flex; align-items: center; gap: 7px; padding: 7px;
      background: rgba(0,0,0,0.5); backdrop-filter: blur(10px);
      border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; z-index: 1001;
      transition: transform 0.3s cubic-bezier(0.4,0,0.2,1), opacity 0.3s ease;
    }
    .r-status { font-weight: 500; font-size: 13px; padding: 0 7px; color: #fff; }
    .r-btn {
      height: 32px; padding: 0 14px;
      display: flex; align-items: center; justify-content: center;
      border: 1px solid rgba(255,255,255,0.2); border-radius: 8px;
      font-weight: 500; cursor: pointer; background: rgba(255,255,255,0.1);
      color: #fff; font-size: 12px; backdrop-filter: blur(5px);
      transition: all 0.2s ease; font-family: inherit;
    }
    .r-btn:hover { background: rgba(255,255,255,0.2); transform: translateY(-1px); }
    .r-btn:active { transform: translateY(1px); }
    .r-btn.active { background: #3b82f6; border-color: #2563eb; }
    .loop-label { position: relative; display: flex; }
    .loop-label input { display: none; }
    .r-period-group { position: relative; display: flex; align-items: center; font-size: 12px; }
    .r-period-group::after { content: 's'; position: absolute; right: 8px; color: rgba(255,255,255,0.7); pointer-events: none; }
    .r-period-group input {
      width: 56px; height: 32px; background: rgba(255,255,255,0.1); color: #fff;
      border: 1px solid rgba(255,255,255,0.2); padding: 0 17px 0 7px;
      border-radius: 8px; -moz-appearance: textfield; transition: all 0.2s;
      cursor: pointer; font-family: inherit;
    }
    .r-period-group input:hover { background: rgba(255,255,255,0.2); }
    .r-period-group input::-webkit-inner-spin-button,
    .r-period-group input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
    .r-main-area { position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 1; overflow: hidden; pointer-events: none; }
    .r-img-container {
      position: absolute; top: 0; left: 0; width: 100%; height: 100%;
      display: flex; align-items: center; justify-content: center;
      padding-bottom: 100px; pointer-events: auto;
      transition: padding-bottom 0.3s cubic-bezier(0.4,0,0.2,1);
    }
    .r-img-container.actual-size { overflow: auto; padding-bottom: 0; }
    .r-img-container img { width: 100%; height: 100%; object-fit: contain; transition: opacity 0.15s; }
    .r-img-container.actual-size img { max-width: none; max-height: none; width: auto; height: auto; margin: auto; }
    .r-nav-btn {
      position: absolute; top: 50%; transform: translateY(-50%); z-index: 2;
      background: rgba(255,255,255,0.1); border: none; color: #fff;
      font-size: 28px; width: 60px; height: 80px; border-radius: 8px;
      cursor: pointer; pointer-events: auto;
      display: flex; align-items: center; justify-content: center;
      transition: background 0.2s, opacity 0.3s ease;
    }
    .r-nav-btn.prev { left: 14px; }
    .r-nav-btn.next { right: 14px; }
    .r-nav-btn:hover { background: rgba(255,255,255,0.22); }
    .r-bottom-bar {
      position: absolute; bottom: 0; left: 0; width: 100%; height: 100px;
      background: rgba(0,0,0,0.8); padding: 7px;
      display: flex; align-items: center; overflow-x: auto;
      border-top: 1px solid rgba(255,255,255,0.1); z-index: 10;
      scrollbar-color: rgba(255,255,255,0.3) transparent;
      transition: transform 0.3s cubic-bezier(0.4,0,0.2,1), opacity 0.3s ease;
    }
    .r-bottom-bar::-webkit-scrollbar { height: 8px; }
    .r-bottom-bar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.3); border-radius: 4px; }
    .r-thumbs { display: flex; gap: 0.5rem; min-width: min-content; margin: 0 auto; }
    .r-thumb {
      width: 80px; height: 80px; object-fit: cover; flex-shrink: 0;
      cursor: pointer; border: 2px solid rgba(255,255,255,0.15);
      border-radius: 4px; opacity: 0.55; transition: all 0.2s; background: #000;
    }
    .r-thumb.active { border-color: #fff !important; border-width: 3px; opacity: 1; }
    .r-thumb:hover { opacity: 1; }
    .r-show-ui-btn {
      position: absolute; top: 10px; right: 10px;
      width: 28px; height: 28px; padding: 0;
      display: flex; align-items: center; justify-content: center;
      background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15);
      border-radius: 50%; color: rgba(255,255,255,0.5); font-size: 13px;
      cursor: pointer; z-index: 2000; font-family: inherit;
      transition: all 0.25s ease;
      opacity: 0; pointer-events: none;
    }
    .r-show-ui-btn.visible { opacity: 1; pointer-events: auto; }
    .r-show-ui-btn:hover { background: rgba(255,255,255,0.18); border-color: rgba(255,255,255,0.35); color: white; }
    .controls-hidden .r-control-panel,
    .ui-hidden .r-control-panel { transform: translateY(-20px); opacity: 0; pointer-events: none; }
    .controls-hidden .r-nav-btn,
    .ui-hidden .r-nav-btn { opacity: 0; pointer-events: none; }
    .ui-hidden .r-bottom-bar { transform: translateY(100%); opacity: 0; pointer-events: none; }
    .ui-hidden .r-img-container { padding-bottom: 0; }
  </style>
</head>
<body>
  <header>
    <h1>${pageTitle || 'Image Collection'}</h1>
    <div class="source">Source: <a href="${pageUrl || '#'}" style="color:inherit">${pageUrl || 'Local'}</a></div>
    <div class="source">Captured on: ${new Date().toLocaleString()}</div>
    <button class="review-btn-header" id="reviewAllBtn">&#9654; Review Slideshow</button>
  </header>
  <div class="gallery">${itemsHtml}</div>
  <footer>Generated by Image Collector</footer>

  <div class="review-overlay" id="reviewOverlay">
    <button class="r-show-ui-btn" id="showUiBtn">&#x2715;</button>
    <div class="r-control-panel">
      <div class="r-status" id="rStatus">0 / 0</div>
      <label class="r-btn loop-label" id="loopLabel">
        <input type="checkbox" id="loopBtn" checked>
        <span>Loop</span>
      </label>
      <div class="r-period-group">
        <input type="number" id="periodInput" value="1.5" min="0.5" step="0.5">
      </div>
      <button class="r-btn" id="playBtn">Play</button>
      <button class="r-btn" id="scaleBtn">Fit</button>
      <button class="r-btn" id="hideUiBtn">Full Page</button>
      <button class="r-btn" id="closeBtn">&#x2715; Close</button>
    </div>
    <div class="r-main-area">
      <div class="r-img-container" id="rImgContainer">
        <img id="rMainImg" src="" alt="Review Image">
      </div>
      <button class="r-nav-btn prev" id="rPrevBtn">&#8249;</button>
      <button class="r-nav-btn next" id="rNextBtn">&#8250;</button>
    </div>
    <div class="r-bottom-bar" id="rBottomBar">
      <div class="r-thumbs" id="rThumbs"></div>
    </div>
  </div>

  <script>
    (function () {
      var BASE_H = 400, MAX_RATIO = 1.6, GAP = 4, loaded = 0;
      var allImgs = document.querySelectorAll('.gallery img');
      var total = allImgs.length;
      function justify() {
        var gallery = document.querySelector('.gallery');
        var W = gallery.clientWidth;
        var items = Array.from(gallery.children);
        var ratios = items.map(function (item) {
          var img = item.querySelector('img');
          if (!img || !img.naturalWidth) return 1;
          return Math.min(img.naturalWidth / img.naturalHeight, MAX_RATIO);
        });
        items.forEach(function (item) {
          var img = item.querySelector('img');
          if (img && img.naturalWidth && img.naturalWidth / img.naturalHeight > MAX_RATIO) img.style.objectFit = 'cover';
        });
        var row = [], rowStart = 0;
        for (var i = 0; i < items.length; i++) {
          row.push(items[i]);
          var rowRatios = ratios.slice(rowStart, i + 1);
          var totalRatio = rowRatios.reduce(function (s, r) { return s + r; }, 0);
          var rowH = (W - (row.length - 1) * GAP) / totalRatio;
          if (rowH <= BASE_H || i === items.length - 1) {
            var h = (i === items.length - 1 && rowH > BASE_H) ? BASE_H : rowH;
            var usedW = 0;
            row.forEach(function (it, j) {
              it.style.height = Math.floor(h) + 'px';
              if (j < row.length - 1) { var w = Math.floor(h * rowRatios[j]); it.style.width = w + 'px'; usedW += w + GAP; }
              else { it.style.width = (i === items.length - 1 && rowH > BASE_H) ? Math.floor(h * rowRatios[j]) + 'px' : (W - usedW) + 'px'; }
            });
            row = []; rowStart = i + 1;
          }
        }
      }
      function onImgReady() { if (++loaded >= total) { justify(); window.addEventListener('resize', justify); } }
      allImgs.forEach(function (img) { img.onload = onImgReady; img.onerror = onImgReady; if (img.complete) onImgReady(); });
    })();

    (function () {
      var galleryItems = Array.from(document.querySelectorAll('.gallery .item'));
      var reviewItems = galleryItems.map(function (el) { var img = el.querySelector('img'); return { url: img.src, name: img.alt }; });
      var overlay = document.getElementById('reviewOverlay');
      var rStatus = document.getElementById('rStatus');
      var rMainImg = document.getElementById('rMainImg');
      var rThumbs = document.getElementById('rThumbs');
      var rImgContainer = document.getElementById('rImgContainer');
      var rBottomBar = document.getElementById('rBottomBar');
      var playBtn = document.getElementById('playBtn');
      var scaleBtn = document.getElementById('scaleBtn');
      var loopBtn = document.getElementById('loopBtn');
      var loopLabel = document.getElementById('loopLabel');
      var periodInput = document.getElementById('periodInput');
      var closeBtn = document.getElementById('closeBtn');
      var hideUiBtn = document.getElementById('hideUiBtn');
      var showUiBtn = document.getElementById('showUiBtn');
      var rPrevBtn = document.getElementById('rPrevBtn');
      var rNextBtn = document.getElementById('rNextBtn');
      var reviewAllBtn = document.getElementById('reviewAllBtn');
      var currentIndex = 0, slideshowInterval = null, isPlaying = false;
      var isActualSize = false, isManuallyHidden = false, hideUiTimeout;
      var scrollDelta = 0, scrollResetTimeout;

      loopBtn.addEventListener('change', function () { loopLabel.classList.toggle('active', loopBtn.checked); });
      if (loopBtn.checked) loopLabel.classList.add('active');

      function buildThumbs() {
        rThumbs.innerHTML = '';
        reviewItems.forEach(function (item, i) {
          var img = document.createElement('img');
          img.src = item.url; img.className = 'r-thumb'; img.title = item.name;
          img.addEventListener('click', function () { showImage(i); });
          rThumbs.appendChild(img);
        });
      }

      function showImage(index) {
        if (index < 0 || index >= reviewItems.length) return;
        currentIndex = index;
        rMainImg.src = reviewItems[index].url;
        rStatus.textContent = (index + 1) + ' / ' + reviewItems.length;
        var thumbs = rThumbs.querySelectorAll('.r-thumb');
        thumbs.forEach(function (t, i) { t.classList.toggle('active', i === index); });
        if (thumbs[index] && !overlay.classList.contains('ui-hidden'))
          thumbs[index].scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      }

      function openReview(startIndex) {
        buildThumbs();
        overlay.classList.add('active');
        document.body.style.overflow = 'hidden';
        showImage(startIndex || 0);
        resetHideUiTimeout();
        document.addEventListener('keydown', keydownHandler);
      }

      function closeReview() {
        stopSlideshow();
        overlay.classList.remove('active', 'ui-hidden', 'controls-hidden');
        document.body.style.overflow = '';
        document.removeEventListener('keydown', keydownHandler);
      }

      function nextImage(auto) {
        if (!reviewItems.length) return;
        var next = currentIndex + 1;
        if (next >= reviewItems.length) { if (loopBtn.checked) next = 0; else { if (auto) stopSlideshow(); return; } }
        showImage(next);
      }

      function prevImage() {
        if (!reviewItems.length) return;
        var prev = currentIndex - 1;
        if (prev < 0) { if (loopBtn.checked) prev = reviewItems.length - 1; else return; }
        showImage(prev);
      }

      function startSlideshow() {
        isPlaying = true; playBtn.textContent = 'Pause';
        var period = parseFloat(periodInput.value) || 1;
        if (period < 0.1) period = 0.1;
        slideshowInterval = setInterval(function () { nextImage(true); }, period * 1000);
      }

      function stopSlideshow() {
        isPlaying = false; playBtn.textContent = 'Play';
        if (slideshowInterval) { clearInterval(slideshowInterval); slideshowInterval = null; }
      }

      function resetHideUiTimeout() {
        if (isManuallyHidden) return;
        overlay.classList.remove('controls-hidden');
        clearTimeout(hideUiTimeout);
        hideUiTimeout = setTimeout(function () { overlay.classList.add('controls-hidden'); }, 3000);
      }

      galleryItems.forEach(function (el, i) { el.addEventListener('click', function () { openReview(i); }); });
      reviewAllBtn.addEventListener('click', function () { openReview(0); });
      closeBtn.addEventListener('click', closeReview);
      playBtn.addEventListener('click', function () { if (isPlaying) stopSlideshow(); else startSlideshow(); });
      periodInput.addEventListener('change', function () { if (isPlaying) { stopSlideshow(); startSlideshow(); } });
      scaleBtn.addEventListener('click', function () {
        isActualSize = !isActualSize;
        rImgContainer.classList.toggle('actual-size', isActualSize);
        scaleBtn.textContent = isActualSize ? 'Original Size' : 'Fit';
      });
      rPrevBtn.addEventListener('click', prevImage);
      rNextBtn.addEventListener('click', function () { nextImage(false); });
      hideUiBtn.addEventListener('click', function (e) {
        e.stopPropagation(); isManuallyHidden = true; clearTimeout(hideUiTimeout);
        overlay.classList.remove('controls-hidden'); overlay.classList.add('ui-hidden');
        showUiBtn.classList.add('visible');
      });
      showUiBtn.addEventListener('click', function (e) {
        e.stopPropagation(); isManuallyHidden = false;
        overlay.classList.remove('ui-hidden'); showUiBtn.classList.remove('visible');
        resetHideUiTimeout();
        var thumbs = rThumbs.querySelectorAll('.r-thumb');
        if (thumbs[currentIndex]) thumbs[currentIndex].scrollIntoView({ behavior: 'auto', inline: 'center', block: 'nearest' });
      });
      overlay.addEventListener('mousemove', resetHideUiTimeout);
      overlay.addEventListener('click', resetHideUiTimeout);
      var lastScrollTime = 0;
      overlay.addEventListener('wheel', function (e) {
        if (e.target.closest && e.target.closest('.r-bottom-bar')) { rBottomBar.scrollLeft += e.deltaY; e.preventDefault(); return; }
        e.preventDefault(); e.stopPropagation();
        if (!isManuallyHidden) resetHideUiTimeout();
        var now = Date.now();
        if (now - lastScrollTime < 250) return;
        var delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        if (delta === 0) return;
        lastScrollTime = now;
        if (delta > 0) nextImage(false); else prevImage();
      }, { passive: false });

      function keydownHandler(e) {
        if (!overlay.classList.contains('active')) return;
        if (e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') return;
        if (e.key === 'ArrowRight') nextImage(false);
        if (e.key === 'ArrowLeft') prevImage();
        if (e.key === 'Escape') closeReview();
        if (e.key === ' ') { e.preventDefault(); if (isPlaying) stopSlideshow(); else startSlideshow(); }
      }
    })();
  <\/script>
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
