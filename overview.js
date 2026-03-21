const extAPI = typeof browser !== 'undefined' ? browser : chrome;

document.addEventListener('DOMContentLoaded', async () => {
  const gallery = document.getElementById('gallery');
  const statusEl = document.getElementById('status');
  const downloadBtn = document.getElementById('downloadBtn');
  const selectAllBtn = document.getElementById('selectAllBtn');
  const selectionCountEl = document.getElementById('selectionCount');
  
  const extCheckboxes = document.querySelectorAll('input[name="ext"]');
  const minWidthInput = document.getElementById('minWidth');
  const minHeightInput = document.getElementById('minHeight');
  const resolveTypesBtn = document.getElementById('resolveTypesBtn');
  const renameSequenceBtn = document.getElementById('renameSequenceBtn');
  const statusBar = document.getElementById('statusBar');

  let rawMediaItems = [];
  let dedupedItems = [];
  let displayItems = [];
  let selectedUrls = new Set();
  let downloadedUrls = new Set();
  let completelySeenUIUrls = new Set();
  let allSelected = false;
  let sourceTabTitle = "Unknown Page";
  let sourceTabUrl = "";

  const extensionCache = new Map();

  const enableMinSizeBtn = document.getElementById('enableMinSizeBtn');

  extCheckboxes.forEach(cb => cb.addEventListener('change', processItems));
  minWidthInput.addEventListener('input', processItems);
  minHeightInput.addEventListener('input', processItems);
  
  if (enableMinSizeBtn) {
    enableMinSizeBtn.addEventListener('change', () => {
      minWidthInput.disabled = !enableMinSizeBtn.checked;
      minHeightInput.disabled = !enableMinSizeBtn.checked;
      processItems();
    });
  }

  resolveTypesBtn.addEventListener('change', async (e) => {
    if (e.target.checked) {
      statusEl.textContent = "Checking network...";
      
      let itemsToFetch = rawMediaItems.filter(item => getExtension(item.url) === 'unknown');

      if (selectedUrls.size > 0) {
        itemsToFetch = itemsToFetch.filter(item => selectedUrls.has(item.url));
      } else {
        itemsToFetch = itemsToFetch.slice(0, 10);
      }

      if (itemsToFetch.length === 0) {
        processItems();
        return;
      }

      for (let i = 0; i < itemsToFetch.length; i++) {
        if (!resolveTypesBtn.checked) break; // User unchecked the box mid-process

        const item = itemsToFetch[i];
        statusEl.textContent = `Resolving ${i + 1}/${itemsToFetch.length} unknown types... (5/sec)`;

        const startTime = Date.now();

        try {
          const response = await fetch(item.url, { method: 'HEAD', cache: 'force-cache' });
          if (response.ok) {
            const contentType = response.headers.get('content-type');
            if (contentType && contentType.startsWith('image/')) {
              let splitExt = contentType.split('/')[1].split(';')[0].toLowerCase();
              if (splitExt === 'jpeg') splitExt = 'jpg';
              if (splitExt === 'svg+xml') splitExt = 'svg';
              extensionCache.set(item.url, splitExt);
            } else {
              extensionCache.set(item.url, 'unknown');
            }
          } else {
            extensionCache.set(item.url, 'unknown');
          }
        } catch (err) {
          extensionCache.set(item.url, 'unknown');
        }

        processItems(); // Dynamically update the gallery on each tick

        // Throttle sequence to hit at most 5 per second
        if (resolveTypesBtn.checked && i < itemsToFetch.length - 1) {
          const elapsed = Date.now() - startTime;
          if (elapsed < 200) {
            await new Promise(r => setTimeout(r, 200 - elapsed));
          }
        }
      }

      if (resolveTypesBtn.checked) {
        processItems();
      }
    } else {
      processItems();
    }
  });

  let activeTabId = null;
  let seenRawUrls = new Set();
  let globalFileGroups = new Map();

  async function fetchImages() {
    if (!activeTabId) return;

    try {
      const results = await extAPI.scripting.executeScript({
        target: { tabId: activeTabId },
        files: ['content.js']
      });

      if (results && results[0] && results[0].result) {
        const fetchedItems = results[0].result;
        let newlyAdded = false;

        fetchedItems.forEach(item => {
          if (!seenRawUrls.has(item.url)) {
            seenRawUrls.add(item.url);
            rawMediaItems.push(item);
            
            let dedupKey = 'unknown';
            try {
              if (!item.url.startsWith('data:')) {
                dedupKey = new URL(item.url).pathname;
              } else {
                dedupKey = item.url.substring(0, 150);
              }
            } catch(e) {
              dedupKey = item.url;
            }
            
            if (!globalFileGroups.has(dedupKey)) {
              globalFileGroups.set(dedupKey, []);
              newlyAdded = true;
            }
            globalFileGroups.get(dedupKey).push(item);
          }
        });

        if (newlyAdded) {
          dedupedItems = [];
          globalFileGroups.forEach(group => {
            group.sort((a, b) => (b.width * b.height) - (a.width * a.height));
            dedupedItems.push(group[0]); 
          });
          processItems(); 
        } else if (rawMediaItems.length === 0) {
          statusEl.textContent = "No images found on this page yet. Scroll to load...";
        }
      }
    } catch (err) {
      console.error(err);
    }
  }

  try {
    const tabs = await extAPI.tabs.query({ active: true, currentWindow: true });
    if (tabs.length === 0) {
      statusEl.textContent = "Error: No active tab found.";
      return;
    }

    sourceTabTitle = tabs[0].title || "Downloaded Images";
    sourceTabUrl = tabs[0].url || "Unknown URL";
    activeTabId = tabs[0].id;

    await fetchImages();
    setInterval(fetchImages, 1000);
  } catch (err) {
    statusEl.textContent = "Error hooking into active tab.";
    console.error(err);
  }

  function getExtension(url) {
    if (extensionCache.has(url)) return extensionCache.get(url);

    if (url.startsWith('data:image/')) {
      const match = url.match(/data:image\/([a-zA-Z0-9]+);/);
      if (match) {
        let ext = match[1].toLowerCase();
        if (ext === 'jpeg') return 'jpg';
        return ext;
      }
      return 'unknown';
    }

    try {
      const pathname = new URL(url).pathname;
      const parts = pathname.split('/');
      let filename = parts[parts.length - 1];

      if (filename.includes('.')) {
        let ext = filename.split('.').pop().toLowerCase();
        if (ext === 'jpeg') return 'jpg';
        if (['jpg', 'png', 'gif', 'webp', 'svg', 'ico', 'avif', 'bmp'].includes(ext)) {
          return ext;
        }
      }
    } catch (e) { }

    return 'unknown';
  }

  function processItems() {
    const allowedExts = new Set();
    extCheckboxes.forEach(cb => {
      if (cb.checked) allowedExts.add(cb.value);
    });

    const minW = parseInt(minWidthInput.value, 10) || 0;
    const minH = parseInt(minHeightInput.value, 10) || 0;

    displayItems = dedupedItems.filter(item => {
      // 1. Ignore strictly zero-dimension items
      if (!item.width || !item.height || item.width === 0 || item.height === 0) {
        return false;
      }

      // 2. Ignore tiny images
      if (item.width <= 32 && item.height <= 32) {
        return false;
      }

      // 3. Filter by extension
      const itemExt = getExtension(item.url);
      const mappedExt = ['jpg', 'png', 'gif', 'webp', 'svg'].includes(itemExt) ? itemExt : 'other';
      if (!allowedExts.has(mappedExt)) return false;

      // 4. Min size filter
      if (!enableMinSizeBtn || enableMinSizeBtn.checked) {
        if (minW > 0 && item.width < minW) return false;
        if (minH > 0 && item.height < minH) return false;
      }

      return true;
    });

    displayItems.forEach(item => {
      if (!completelySeenUIUrls.has(item.url)) {
        completelySeenUIUrls.add(item.url);
        selectedUrls.add(item.url);
      }
    });

    const displayUrls = new Set(displayItems.map(item => item.url));
    for (let url of selectedUrls) {
      if (!displayUrls.has(url)) {
        selectedUrls.delete(url);
      }
    }

    statusEl.textContent = `Found ${displayItems.length} images`;
    updateSelectionState();
    renderGallery();
  }

  function renderGallery() {
    gallery.innerHTML = '';
    
    displayItems.forEach(item => {
      const itemEl = document.createElement('div');
      itemEl.className = 'media-item';
      itemEl.dataset.url = item.url;
      if (selectedUrls.has(item.url)) {
        itemEl.classList.add('selected');
      }
      if (downloadedUrls.has(item.url)) {
        itemEl.classList.add('downloaded');
      }
      
      const typeBadge = document.createElement('div');
      typeBadge.className = 'media-type-badge';
      let ext = getExtension(item.url);
      if (ext === 'unknown') ext = 'IMG';
      typeBadge.textContent = ext.toUpperCase();
      
      const checkmark = document.createElement('div');
      checkmark.className = 'checkmark';

      const mediaContent = document.createElement('img');
      mediaContent.src = item.url;
      mediaContent.loading = 'lazy';

      itemEl.appendChild(mediaContent);
      itemEl.appendChild(typeBadge);
      
      const downloadBadge = document.createElement('div');
      downloadBadge.className = 'download-badge';
      itemEl.appendChild(downloadBadge);
      
      if (item.width && item.height && item.width > 0 && item.height > 0) {
        const sizeBadge = document.createElement('div');
        sizeBadge.className = 'size-badge';
        sizeBadge.textContent = `${item.width}x${item.height}`;
        itemEl.appendChild(sizeBadge);
      }

      itemEl.appendChild(checkmark);
      
      // Select item on click
      itemEl.addEventListener('click', () => {
         toggleSelection(itemEl, item.url);
      });
      
      // Drag and Drop Logic
      itemEl.draggable = true;
      itemEl.addEventListener('dragstart', e => {
        e.dataTransfer.setData('text/plain', item.url);
        itemEl.classList.add('dragging');
      });
      
      itemEl.addEventListener('dragend', () => {
        itemEl.classList.remove('dragging');
        document.querySelectorAll('.media-item').forEach(el => el.classList.remove('drag-over'));
      });
      
      itemEl.addEventListener('dragover', e => {
        e.preventDefault(); 
      });
      
      itemEl.addEventListener('dragenter', e => {
        e.preventDefault();
        if (!itemEl.classList.contains('dragging')) {
           itemEl.classList.add('drag-over');
        }
      });
      
      itemEl.addEventListener('dragleave', e => {
         itemEl.classList.remove('drag-over');
      });
      
      itemEl.addEventListener('drop', e => {
        e.preventDefault();
        itemEl.classList.remove('drag-over');
        const draggedUrl = e.dataTransfer.getData('text/plain');
        if (draggedUrl && draggedUrl !== item.url) {
           reorderItems(draggedUrl, item.url);
        }
      });
      
      // Status bar updates
      itemEl.addEventListener('mouseenter', () => {
        statusBar.textContent = item.url;
        statusBar.style.color = 'var(--text-main)';
      });
      itemEl.addEventListener('mouseleave', () => {
        statusBar.textContent = 'Hover over an image to view its URL';
        statusBar.style.color = 'var(--text-muted)';
      });
      
      gallery.appendChild(itemEl);
    });
  }

  function toggleSelection(element, url) {
    if (selectedUrls.has(url)) {
      selectedUrls.delete(url);
      element.classList.remove('selected');
    } else {
      selectedUrls.add(url);
      element.classList.add('selected');
    }
    updateSelectionState();
  }

  function reorderItems(draggedUrl, targetUrl) {
    const draggedIdx = displayItems.findIndex(i => i.url === draggedUrl);
    const targetIdx = displayItems.findIndex(i => i.url === targetUrl);
    
    if (draggedIdx > -1 && targetIdx > -1) {
      // Reorder mapped rendering sequence
      const [item] = displayItems.splice(draggedIdx, 1);
      displayItems.splice(targetIdx, 0, item);
      
      // Persist absolute order to primary deduped source array
      const dDragIdx = dedupedItems.findIndex(i => i.url === draggedUrl);
      const dTargetIdx = dedupedItems.findIndex(i => i.url === targetUrl);
      if (dDragIdx > -1 && dTargetIdx > -1) {
          const [dItem] = dedupedItems.splice(dDragIdx, 1);
          dedupedItems.splice(dTargetIdx, 0, dItem);
      }
      
      renderGallery();
    }
  }

  function updateSelectionState() {
    selectionCountEl.textContent = selectedUrls.size;
    downloadBtn.disabled = selectedUrls.size === 0;

    allSelected = displayItems.length > 0 && selectedUrls.size === displayItems.length;
    selectAllBtn.textContent = allSelected ? "Deselect All" : "Select All";
  }

  selectAllBtn.addEventListener('click', () => {
    const elements = document.querySelectorAll('.media-item');
    if (allSelected) {
      selectedUrls.clear();
      elements.forEach(el => el.classList.remove('selected'));
    } else {
      displayItems.forEach(item => selectedUrls.add(item.url));
      elements.forEach(el => el.classList.add('selected'));
    }
    updateSelectionState();
  });

  downloadBtn.addEventListener('click', async () => {
    // Sanitize title for valid folder name
    let safeTitle = sourceTabTitle.replace(/[^a-z0-9\u4e00-\u9fa5]/gi, '_').replace(/_{2,}/g, '_').substring(0, 50).replace(/^_|_$/g, '');
    if (!safeTitle) {
      try {
        safeTitle = new URL(sourceTabUrl).hostname.replace(/[^a-z0-9]/gi, '_');
      } catch (e) {
        safeTitle = 'image_collection';
      }
    }

    const folderName = safeTitle;
    let seqIndex = 1;

    const itemsToDownload = displayItems.filter(item => selectedUrls.has(item.url));
    const originalText = downloadBtn.textContent;
    downloadBtn.disabled = true;
    
    let logContent = `Media Collector Export Log\nSource: ${sourceTabUrl}\nTimestamp: ${new Date().toLocaleString()}\n=========================================\n\n`;
    const payloadItems = [];

    for (let i = 0; i < itemsToDownload.length; i++) {
      const item = itemsToDownload[i];
      let filename = 'downloaded_image';
      try {
        if (!item.url.startsWith('data:')) {
          filename = new URL(item.url).pathname.split('/').pop() || 'downloaded_image';
          
          const validExts = /\.(jpg|jpeg|png|gif|webp|svg|avif|ico|bmp)$/i;
          if (!validExts.test(filename)) {
            filename = filename.replace(/\.[^/.]+$/, '') || 'downloaded_image';
            const ext = getExtension(item.url);
            filename += `.${ext !== 'unknown' ? ext : 'unknown'}`;
          }
        } else {
          const ext = getExtension(item.url);
          filename = `data_image.${ext !== 'unknown' ? ext : 'png'}`;
        }
      } catch (e) {
        filename += '.unknown';
      }

      filename = decodeURIComponent(filename);

      if (renameSequenceBtn && renameSequenceBtn.checked) {
         const padZero = String(seqIndex).padStart(3, '0');
         filename = `${padZero}_${filename}`;
         seqIndex++;
      }
      
      logContent += `File: ${filename}\nURL: ${item.url}\n\n`;

      payloadItems.push({
        url: item.url,
        filename: `${folderName}/${filename}`
      });
    }
    
    extAPI.runtime.sendMessage({
      action: "start_downloads",
      items: payloadItems,
      logContent: logContent,
      folderName: folderName
    });

    const els = Array.from(gallery.children);
    Array.from(selectedUrls).forEach(url => {
       downloadedUrls.add(url);
       const targetEl = els.find(el => el.dataset.url === url);
       if (targetEl) targetEl.classList.add('downloaded');
    });

    downloadBtn.textContent = "Sent to Background 🚀";
    setTimeout(() => {
       downloadBtn.textContent = originalText;
       downloadBtn.disabled = selectedUrls.size === 0;
    }, 2500);
  });
});
