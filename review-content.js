(async () => {
  const extAPI = typeof browser !== 'undefined' ? browser : chrome;

  // Cleanup old overlay if present
  const existingHost = document.getElementById('image-collector-review-host');
  if (existingHost) {
    existingHost.remove();
  }

  // Restore state from local storage
  const storageData = await new Promise(resolve => {
    extAPI.storage.local.get(['reviewItems', 'deselectedUrls'], resolve);
  });

  const reviewItems = storageData.reviewItems || [];
  let deselectedUrls = new Set(storageData.deselectedUrls || []);

  if (reviewItems.length === 0) return;

  // Create Shadow Root Host
  const host = document.createElement('div');
  host.id = 'image-collector-review-host';
  // Render over everything
  host.style.position = 'fixed';
  host.style.top = '0';
  host.style.left = '0';
  host.style.width = '100vw';
  host.style.height = '100vh';
  host.style.zIndex = '2147483647'; // max z-index
  host.style.pointerEvents = 'auto'; // allow interaction

  const shadow = host.attachShadow({ mode: 'open' });

  // CSS Styles
  const style = document.createElement('style');
  style.textContent = `
    * {
      box-sizing: border-box;
      font-family: system-ui, -apple-system, sans-serif;
    }
    .review-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      overflow: hidden;
      background-color: rgba(0, 0, 0, 0.95);
      display: block;
      color: white;
      margin: 0;
      padding: 0;
    }
    .review-overlay.hidden {
      display: none !important;
    }
    .review-control-panel {
      position: absolute;
      top: 14px;
      right: 14px;
      display: flex;
      align-items: center;
      gap: 7px;
      padding: 7px;
      background-color: rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(10px);
      z-index: 1001;
      border-radius: 12px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease;
    }
    .review-status-badge {
      font-weight: 500;
      font-size: 13px;
      padding: 0 7px;
      color: white;
    }
    .loop-btn {
      position: relative;
    }
    .loop-btn input {
      display: none;
    }
    .btn.active {
      background-color: #3b82f6;
      border-color: #2563eb;
      color: #fff;
    }
    .review-period-group {
      position: relative;
      display: flex;
      align-items: center;
      font-size: 12px;
    }
    .review-period-group::after {
      content: 's';
      position: absolute;
      right: 8px;
      color: rgba(255, 255, 255, 0.7);
      pointer-events: none;
    }
    .review-period-group input {
      width: 56px;
      height: 32px;
      background-color: rgba(255, 255, 255, 0.1);
      color: white;
      border: 1px solid rgba(255, 255, 255, 0.2);
      padding: 0 17px 0 7px;
      border-radius: 8px;
      -moz-appearance: textfield;
      transition: all 0.2s ease;
      cursor: pointer;
    }
    .review-period-group input:hover {
      background-color: rgba(255, 255, 255, 0.2);
      transform: translateY(-1px);
    }
    .review-period-group input:active {
      transform: translateY(1px);
    }
    .review-period-group input::-webkit-inner-spin-button,
    .review-period-group input::-webkit-outer-spin-button {
      -webkit-appearance: none;
      margin: 0;
    }
    .btn {
      height: 32px;
      padding: 0 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 8px;
      font-weight: 500;
      cursor: pointer;
      background-color: rgba(255, 255, 255, 0.1);
      color: white;
      font-size: 12px;
      backdrop-filter: blur(5px);
      transition: all 0.2s ease;
    }
    .btn:hover { 
      background-color: rgba(255, 255, 255, 0.2); 
      transform: translateY(-1px);
    }
    .btn:active {
      transform: translateY(1px);
    }
    .review-main-area {
      position: absolute;
      top: 0; 
      left: 0; 
      width: 100%; 
      height: 100%;
      z-index: 1;
      overflow: hidden;
      pointer-events: none;
    }
    .review-img-container {
      position: absolute;
      top: 0; 
      left: 0; 
      width: 100%; 
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
      padding-bottom: 100px;
      pointer-events: auto;
      transition: padding-bottom 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .ui-hidden .review-img-container {
      padding-bottom: 0;
    }
    .review-img-container.actual-size {
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: auto;
      padding-bottom: 0;
    }
    .review-img-container.actual-size img {
      max-width: none;
      max-height: none;
      width: auto;
      height: auto;
      margin: auto;
    }
    .review-img-container img {
      width: 100%;
      height: 100%;
      object-fit: contain;
      transition: opacity 0.2s;
    }
    .review-img-container img.deselected {
      opacity: 0.4;
      filter: grayscale(80%);
    }
    .review-nav-btn {
      position: absolute;
      top: 50%;
      transform: translateY(-50%);
      z-index: 2;
      background: rgba(255, 255, 255, 0.1);
      border: none;
      color: white;
      font-size: 28px;
      width: 60px;
      height: 80px;
      border-radius: 8px;
      cursor: pointer;
      transition: background 0.2s, opacity 0.3s ease, transform 0.2s;
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: auto;
    }
    .review-nav-btn.prev { left: 14px; }
    .review-nav-btn.next { right: 14px; }
    .review-nav-btn:hover { background: rgba(255, 255, 255, 0.2); transform: translateY(-50%) scale(1.05); }
    .review-nav-btn:active { transform: translateY(-50%) scale(0.95); }
    .review-bottom-bar {
      position: absolute;
      bottom: 0;
      left: 0;
      width: 100%;
      height: 100px;
      background-color: rgba(0, 0, 0, 0.8);
      padding: 7px;
      display: flex;
      align-items: center;
      justify-content: flex-start;
      overflow-x: auto;
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      scrollbar-color: rgba(255, 255, 255, 0.3) transparent;
      z-index: 10;
    }
    .review-bottom-bar::-webkit-scrollbar { height: 8px; }
    .review-bottom-bar::-webkit-scrollbar-track { background: transparent; }
    .review-bottom-bar::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.3); border-radius: 4px; }
    
    .review-thumbnails-container {
      display: flex;
      gap: 7px;
      min-width: min-content;
      margin: 0 auto;
    }
    .review-thumb {
      width: 80px;
      height: 80px;
      object-fit: cover;
      cursor: pointer;
      border: 2px solid #3b82f6; /* Selected by default */
      border-radius: 4px;
      opacity: 0.7;
      transition: all 0.2s;
      background-color: #000;
    }
    .review-thumb.active { border-color: #fff !important; border-width: 3px; }
    .review-thumb.downloaded { border-color: #22c55e !important; }
    .review-thumb.failed { border-color: #fab005 !important; }
    .review-thumb.active:not(.deselected) { opacity: 1; }
    .review-thumb:hover { opacity: 1; }
    .review-thumb.deselected {
      border-color: rgba(255, 255, 255, 0.1);
      opacity: 0.2;
      filter: grayscale(80%);
    }
    
    .thumb-wrapper {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 80px;
      min-height: 80px;
      height: 80px;
      flex-shrink: 0;
      box-sizing: border-box;
    }
    .thumb-check {
      display: none;
    }
      position: absolute;
      top: 4px;
      right: 4px;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background-color: rgba(59, 130, 246, 0.7);
      border: 2px solid rgba(255, 255, 255, 0.8);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      z-index: 10;
      transition: all 0.2s;
    }
    .thumb-check::after {
      content: '';
      width: 5px;
      height: 10px;
      border: solid white;
      border-width: 0 2px 2px 0;
      transform: rotate(45deg);
      margin-top: -2px;
    }
    .thumb-wrapper.deselected .thumb-check {
      background-color: rgba(0, 0, 0, 0.5);
      border-color: rgba(255, 255, 255, 0.5);
    }
    .thumb-wrapper.deselected .thumb-check::after {
      display: none;
    }

    .review-bottom-bar {
      transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease;
    }
    .review-nav-btn {
      transition: background 0.2s, opacity 0.3s ease;
    }
    .ui-hidden .review-control-panel,
    .controls-hidden .review-control-panel {
      transform: translateY(-20px);
      opacity: 0;
      pointer-events: none;
    }
    .ui-hidden .review-bottom-bar {
      transform: translateY(100%);
      opacity: 0;
      pointer-events: none;
    }
    .ui-hidden .review-nav-btn,
    .controls-hidden .review-nav-btn {
      opacity: 0;
      pointer-events: none;
    }
    .show-ui-btn {
      position: absolute;
      top: 10px;
      right: 10px;
      width: 28px;
      height: 28px;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background-color: rgba(255,255,255,0.08);
      border: 1px solid rgba(255,255,255,0.15);
      border-radius: 50%;
      color: rgba(255,255,255,0.5);
      font-size: 13px;
      cursor: pointer;
      z-index: 2000;
      transition: all 0.25s ease;
      opacity: 1;
      pointer-events: auto;
    }
    .show-ui-btn.hidden {
      opacity: 0;
      pointer-events: none;
    }
    .show-ui-btn:hover {
      background-color: rgba(255,255,255,0.18);
      border-color: rgba(255,255,255,0.35);
      color: white;
    }
  `;
  shadow.appendChild(style);

  // HTML Structure
  const overlay = document.createElement('div');
  overlay.className = 'review-overlay';
  overlay.innerHTML = `
    <button id="showUiBtn" class="show-ui-btn hidden">&#x2715;</button>
    <div class="review-control-panel">
      <div class="review-status-badge" id="reviewStatus">0 / 0</div>
      <label class="btn loop-btn">
        <input type="checkbox" id="reviewLoopBtn" checked>
        <span>Loop</span>
      </label>
      <div class="review-period-group">
        <input type="number" id="reviewPeriodInput" value="1.5" min="0.5" step="0.5">
      </div>
      <button id="reviewPlayBtn" class="btn">Play</button>
      <button id="reviewScaleBtn" class="btn">Fit</button>
      <button id="reviewDownloadBtn" class="btn">Download</button>
      <button id="hideUiBtn" class="btn">Full Page</button>
      <button id="reviewCloseBtn" class="btn">Close</button>
    </div>
    
    <div class="review-main-area">
      <div class="review-img-container">
        <img id="reviewMainImg" src="" alt="Review Image">
      </div>
      <button id="reviewPrevBtn" class="review-nav-btn prev">&lt;</button>
      <button id="reviewNextBtn" class="review-nav-btn next">&gt;</button>
    </div>

    <div class="review-bottom-bar">
      <div id="reviewThumbnails" class="review-thumbnails-container"></div>
    </div>
  `;
  shadow.appendChild(overlay);
  document.body.appendChild(host);
  const _savedOverflow = document.documentElement.style.overflowY;
  document.documentElement.style.overflowY = 'hidden';

  // JavaScript Logic Elements
  const reviewCloseBtn = shadow.getElementById('reviewCloseBtn');
  const reviewDownloadBtn = shadow.getElementById('reviewDownloadBtn');
  const reviewScaleBtn = shadow.getElementById('reviewScaleBtn');
  const reviewPrevBtn = shadow.getElementById('reviewPrevBtn');
  const reviewNextBtn = shadow.getElementById('reviewNextBtn');
  const reviewMainImg = shadow.getElementById('reviewMainImg');
  const reviewThumbnails = shadow.getElementById('reviewThumbnails');
  const reviewStatus = shadow.getElementById('reviewStatus');
  const reviewPlayBtn = shadow.getElementById('reviewPlayBtn');
  const reviewPeriodInput = shadow.getElementById('reviewPeriodInput');
  const reviewLoopBtn = shadow.getElementById('reviewLoopBtn');
  const hideUiBtn = shadow.getElementById('hideUiBtn');
  const showUiBtn = shadow.getElementById('showUiBtn');
  const loopBtnLabel = shadow.querySelector('.loop-btn');

  reviewLoopBtn.addEventListener('change', (e) => {
    if (e.target.checked) loopBtnLabel.classList.add('active');
    else loopBtnLabel.classList.remove('active');
  });
  if (reviewLoopBtn.checked) loopBtnLabel.classList.add('active');

  let isActualSize = false;
  reviewScaleBtn.addEventListener('click', () => {
    isActualSize = !isActualSize;
    const container = shadow.querySelector('.review-img-container');
    if (isActualSize) {
      container.classList.add('actual-size');
      reviewScaleBtn.textContent = 'Original Size';
    } else {
      container.classList.remove('actual-size');
      reviewScaleBtn.textContent = 'Fit';
    }
  });

  let currentReviewIndex = 0;
  let slideshowInterval = null;
  let isSlideshowPlaying = false;
  let downloadedUrls = new Set();

  // Initialize
  populateReviewThumbnails();
  showReviewImage(currentReviewIndex);

  function populateReviewThumbnails() {
    reviewThumbnails.innerHTML = '';
    reviewItems.forEach((item, index) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'thumb-wrapper';

      const img = document.createElement('img');
      img.src = item.url;
      img.className = 'review-thumb';

      const checkBtn = document.createElement('div');
      checkBtn.className = 'thumb-check';

      if (deselectedUrls.has(item.url)) {
        img.classList.add('deselected');
        wrapper.classList.add('deselected');
      }

      if (downloadedUrls.has(item.url)) {
        img.classList.add('downloaded');
      }

      img.addEventListener('click', () => {
        if (index === currentReviewIndex) {
          toggleSelection(index);
        } else {
          showReviewImage(index);
        }
      });

      wrapper.appendChild(img);
      wrapper.appendChild(checkBtn);
      reviewThumbnails.appendChild(wrapper);
    });
  }

  function toggleSelection(index) {
    if (index < 0 || index >= reviewItems.length) return;
    const item = reviewItems[index];
    const isDeselected = deselectedUrls.has(item.url);
    const wrapper = reviewThumbnails.children[index];
    const img = wrapper.querySelector('.review-thumb');

    if (isDeselected) {
      deselectedUrls.delete(item.url);
      img.classList.remove('deselected');
      wrapper.classList.remove('deselected');
      if (currentReviewIndex === index) reviewMainImg.classList.remove('deselected');
    } else {
      deselectedUrls.add(item.url);
      img.classList.add('deselected');
      wrapper.classList.add('deselected');
      if (currentReviewIndex === index) reviewMainImg.classList.add('deselected');
    }
  }

  function showReviewImage(index) {
    if (index < 0 || index >= reviewItems.length) return;
    currentReviewIndex = index;
    const item = reviewItems[index];

    reviewMainImg.src = item.url;

    const isDeselected = deselectedUrls.has(item.url);
    if (isDeselected) {
      reviewMainImg.classList.add('deselected');
    } else {
      reviewMainImg.classList.remove('deselected');
    }

    reviewStatus.textContent = `${index + 1} / ${reviewItems.length}`;

    const wrappers = reviewThumbnails.children;
    for (let i = 0; i < wrappers.length; i++) {
      const img = wrappers[i].querySelector('.review-thumb');
      if (img) img.classList.remove('active');
    }
    if (wrappers[index]) {
      const img = wrappers[index].querySelector('.review-thumb');
      if (img) img.classList.add('active');
      if (!overlay.classList.contains('ui-hidden')) {
        wrappers[index].scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      }
    }
  }

  function nextReviewImage(auto = false) {
    if (reviewItems.length === 0) return;

    let nextIndex = currentReviewIndex;
    let iterations = 0;

    do {
      nextIndex++;
      if (nextIndex >= reviewItems.length) {
        if (reviewLoopBtn.checked || (auto && reviewLoopBtn.checked)) {
          nextIndex = 0;
        } else if (auto && !reviewLoopBtn.checked) {
          stopSlideshow();
          return;
        } else {
          return;
        }
      }
      iterations++;

      // Stop infinite looping if all items are somehow deselected
      if (iterations >= reviewItems.length) {
        if (auto) stopSlideshow();
        return;
      }
    } while (deselectedUrls.has(reviewItems[nextIndex].url));

    showReviewImage(nextIndex);
  }

  function prevReviewImage() {
    if (reviewItems.length === 0) return;

    let prevIndex = currentReviewIndex;
    let iterations = 0;

    do {
      prevIndex--;
      if (prevIndex < 0) {
        if (reviewLoopBtn.checked) {
          prevIndex = reviewItems.length - 1;
        } else {
          return;
        }
      }
      iterations++;

      if (iterations >= reviewItems.length) return;
    } while (deselectedUrls.has(reviewItems[prevIndex].url));

    showReviewImage(prevIndex);
  }

  reviewNextBtn.addEventListener('click', () => nextReviewImage());
  reviewPrevBtn.addEventListener('click', () => prevReviewImage());

  function closeOverlay() {
    stopSlideshow();
    document.documentElement.style.overflowY = _savedOverflow;
    host.remove();
    document.removeEventListener('keydown', keydownHandler);
  }

  reviewCloseBtn.addEventListener('click', closeOverlay);

  reviewDownloadBtn.addEventListener('click', () => {
    const itemsToDownload = reviewItems.filter(item => !deselectedUrls.has(item.url));
    if (itemsToDownload.length === 0) return;

    let safeTitle = document.title.replace(/[^a-z0-9\u4e00-\u9fa5]/gi, '_').replace(/_{2,}/g, '_').substring(0, 50).replace(/^_|_$/g, '');
    if (!safeTitle) safeTitle = window.location.hostname.replace(/[^a-z0-9]/gi, '_');

    const folderName = safeTitle || 'image_collection';
    const payloadItems = [];



    function getExtension(url) {
      if (url.startsWith('data:image/')) {
        const match = url.match(/data:image\/([a-zA-Z0-9+]+)[;,]/);
        if (match) {
          let ext = match[1].toLowerCase();
          if (ext === 'jpeg') return 'jpg';
          if (ext === 'svg+xml') return 'svg';
          return ext;
        }
        return 'png';
      }
      const p = url.split(/[#?]/)[0];
      const parts = p.split('.');
      if (parts.length > 1) {
        const ext = parts.pop().toLowerCase();
        if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif', 'ico', 'bmp'].includes(ext)) {
          return ext === 'jpeg' ? 'jpg' : ext;
        }
      }
      return 'unknown';
    }

    for (let i = 0; i < itemsToDownload.length; i++) {
      const item = itemsToDownload[i];
      const cleanUrl = item.url.trim();
      let filename = 'downloaded_image';
      try {
        if (!cleanUrl.startsWith('data:')) {
          filename = new URL(cleanUrl).pathname.split('/').pop() || 'downloaded_image';
          let ext = getExtension(cleanUrl);
          if (ext !== 'unknown' && !filename.toLowerCase().endsWith('.' + ext)) {
            filename = filename.replace(/\.[^/.]+$/, '') || 'downloaded_image';
            filename += '.' + ext;
          }
        } else {
          let ext = getExtension(cleanUrl);
          if (ext === 'svg+xml') ext = 'svg';
          filename = `data_image.${ext !== 'unknown' ? ext : 'png'}`;
        }
      } catch (e) {
        filename += '.unknown';
      }

      filename = decodeURIComponent(filename).replace(/[+;]/g, '_');
      const padZero = String(i + 1).padStart(3, '0');
      filename = `${padZero}_${filename}`;

      payloadItems.push({
        url: cleanUrl,
        filename: `${folderName}/${filename}`
      });
    }

    const originalText = reviewDownloadBtn.textContent;
    reviewDownloadBtn.disabled = true;

    // Listen for background job updates to highlight borders in real-time
    const reviewProgressListener = (msg) => {
      if (msg.action === 'job_update') {
        const thumb = reviewThumbnails.children[msg.index]?.querySelector('.review-thumb');
        if (thumb) {
          thumb.classList.remove('downloaded', 'failed');
          thumb.classList.add(msg.status === 'success' ? 'downloaded' : 'failed');
        }
        reviewDownloadBtn.textContent = `Saving ${msg.index + 1}/${msg.total}`;

        if (msg.index + 1 === msg.total) {
          setTimeout(() => {
            reviewDownloadBtn.textContent = "Done";
            extAPI.runtime.onMessage.removeListener(reviewProgressListener);
            setTimeout(() => {
              reviewDownloadBtn.disabled = false;
              reviewDownloadBtn.textContent = originalText;
            }, 2000);
          }, 300);
        }
      }
    };
    extAPI.runtime.onMessage.addListener(reviewProgressListener);

    // Reset UI indicators before starting fresh download sequence
    reviewThumbnails.querySelectorAll('.review-thumb').forEach(thumb => {
      thumb.classList.remove('downloaded');
      thumb.classList.remove('failed');
    });

    // Start background process (handles queue and final index.html)
    extAPI.runtime.sendMessage({
      action: "start_downloads",
      items: payloadItems,
      sourceTitle: document.title,
      sourceUrl: window.location.href,
      folderName: folderName
    });
  });

  let hideUiTimeout;
  let isManuallyHidden = false;

  function resetHideUiTimeout() {
    if (isManuallyHidden) return;
    overlay.classList.remove('controls-hidden');
    clearTimeout(hideUiTimeout);
    hideUiTimeout = setTimeout(() => {
      overlay.classList.add('controls-hidden');
    }, 3000);
  }

  // Auto-hide UI on inactivity
  overlay.addEventListener('mousemove', resetHideUiTimeout);
  overlay.addEventListener('click', resetHideUiTimeout);
  document.addEventListener('keydown', resetHideUiTimeout);

  // Initialize timer
  resetHideUiTimeout();

  hideUiBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    isManuallyHidden = true;
    clearTimeout(hideUiTimeout);
    overlay.classList.remove('controls-hidden');
    overlay.classList.add('ui-hidden');
    showUiBtn.classList.remove('hidden');
  });

  showUiBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    isManuallyHidden = false;
    overlay.classList.remove('ui-hidden');
    showUiBtn.classList.add('hidden');
    resetHideUiTimeout();
    const wrappers = reviewThumbnails.children;
    if (wrappers[currentReviewIndex]) {
      wrappers[currentReviewIndex].scrollIntoView({ behavior: 'auto', inline: 'center', block: 'nearest' });
    }
  });

  let lastScrollTime = 0;

  overlay.addEventListener('wheel', (e) => {
    // Let user horizontally scroll the thumbnail tray naturally
    if (e.target.closest('.review-bottom-bar')) {
      const bar = shadow.querySelector('.review-bottom-bar');
      bar.scrollLeft += e.deltaY;
      e.preventDefault();
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    if (!isManuallyHidden) resetHideUiTimeout();

    const now = Date.now();
    if (now - lastScrollTime < 250) return;

    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (delta === 0) return;

    lastScrollTime = now;
    if (delta > 0) nextReviewImage();
    else prevReviewImage();
  }, { passive: false });

  function startSlideshow() {
    isSlideshowPlaying = true;
    reviewPlayBtn.textContent = 'Pause';
    let period = parseFloat(reviewPeriodInput.value) || 1;
    if (period < 0.1) period = 0.1;
    slideshowInterval = setInterval(() => nextReviewImage(true), period * 1000);
  }

  function stopSlideshow() {
    isSlideshowPlaying = false;
    reviewPlayBtn.textContent = 'Play';
    if (slideshowInterval) {
      clearInterval(slideshowInterval);
      slideshowInterval = null;
    }
  }

  reviewPlayBtn.addEventListener('click', () => {
    if (isSlideshowPlaying) stopSlideshow();
    else startSlideshow();
  });

  reviewPeriodInput.addEventListener('change', () => {
    if (isSlideshowPlaying) {
      stopSlideshow();
      startSlideshow();
    }
  });

  const keydownHandler = (e) => {
    // Only capture if user is not typing in the input
    if (e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') return;

    if (e.key === 'ArrowRight') nextReviewImage();
    if (e.key === 'ArrowLeft') prevReviewImage();
    if (e.key === 'Escape') {
      closeOverlay();
    }
    if (e.key === ' ') {
      e.preventDefault(); // prevent scroll
      toggleSelection(currentReviewIndex);
    }
  };

  document.addEventListener('keydown', keydownHandler);

})();
