(() => {
  const mediaMap = new Map();

  function addMedia(url, width, height) {
    if (!url || url.startsWith('chrome-extension://') || url.startsWith('moz-extension://')) return;
    
    // remove fragment # hash from URLs
    const cleanUrl = url.split('#')[0];
    
    // Ignore small empty sources
    if (cleanUrl.length === 0) return;

    if (!mediaMap.has(cleanUrl)) {
      mediaMap.set(cleanUrl, { 
        url: cleanUrl, 
        type: 'image', 
        width: Math.round(width) || 0, 
        height: Math.round(height) || 0 
      });
    } else {
      const existing = mediaMap.get(cleanUrl);
      if (width > existing.width) existing.width = Math.round(width);
      if (height > existing.height) existing.height = Math.round(height);
    }
  }

  function getLargestSrcset(srcset, fallbackWidth) {
    if (!srcset) return null;
    const sources = srcset.split(',').map(s => s.trim().split(/\s+/));
    let largestUrl = null;
    let maxW = 0;
    
    for (const source of sources) {
      if (!source[0]) continue;
      const url = source[0];
      const descriptor = source[1] || '1x';
      let w = 0;
      
      if (descriptor.endsWith('w')) {
        w = parseInt(descriptor.replace('w', ''), 10) || 0;
      } else if (descriptor.endsWith('x')) {
        w = (parseFloat(descriptor.replace('x', '')) || 1) * fallbackWidth;
      } else {
        w = fallbackWidth;
      }
      
      if (w > maxW) {
        maxW = w;
        largestUrl = url;
      }
    }
    
    return { url: largestUrl, w: maxW > 10 ? maxW : 0 };
  }

  // 1. img tags and responsive picture tags
  document.querySelectorAll('img').forEach(img => {
    const src = img.src;
    const w = img.naturalWidth || img.width || (src.startsWith('data:') ? img.offsetWidth : 0);
    const h = img.naturalHeight || img.height || (src.startsWith('data:') ? img.offsetHeight : 0);
    addMedia(src, w, h);
    if (img.currentSrc && img.currentSrc !== src) {
      addMedia(img.currentSrc, img.naturalWidth || img.width, img.naturalHeight || img.height);
    }
    
    // Estimate aspect ratio to prevent 0-height discard
    const aspect = (img.naturalHeight && img.naturalWidth) ? 
        (img.naturalHeight / img.naturalWidth) : 
        ((img.height && img.width) ? (img.height / img.width) : 1);

    const fallbackWidth = img.naturalWidth || img.width || 800;

    // Direct img tag srcsets
    if (img.srcset) {
      const best = getLargestSrcset(img.srcset, fallbackWidth);
      if (best && best.url) {
         const a = document.createElement('a');
         a.href = best.url;
         let w = best.w > 0 ? best.w : fallbackWidth;
         let h = Math.round(w * aspect);
         addMedia(a.href, w, h);
      }
    }
    
    // HTML5 picture sibling source tags
    if (img.parentElement && img.parentElement.tagName.toLowerCase() === 'picture') {
      img.parentElement.querySelectorAll('source').forEach(source => {
         if (source.srcset) {
            const best = getLargestSrcset(source.srcset, fallbackWidth);
            if (best && best.url) {
               const a = document.createElement('a');
               a.href = best.url;
               let w = best.w > 0 ? best.w : fallbackWidth;
               let h = Math.round(w * aspect);
               addMedia(a.href, w, h);
            }
         }
      });
    }
  });

  // 2. background images and data URIs on any element
  document.querySelectorAll('*').forEach(el => {
    // Greedy match to capture full URLs (including long data URIs with no early cutoff)
    const bgImage = window.getComputedStyle(el).backgroundImage;
    if (bgImage && bgImage !== 'none') {
      const match = bgImage.match(/url\(["']?(data:[^"')]+|[^"')]+)["']?\)/);
      if (match && match[1]) {
        const a = document.createElement('a');
        a.href = match[1];
        addMedia(a.href, el.offsetWidth || 0, el.offsetHeight || 0);
      }
    }

    // Fallback: read raw inline style for data: URIs that computedStyle may truncate
    const inlineStyle = el.getAttribute('style');
    if (inlineStyle && inlineStyle.includes('data:image')) {
      const dataMatches = [...inlineStyle.matchAll(/url\(["']?(data:image\/[^"')]+)["']?\)/g)];
      for (const m of dataMatches) {
        addMedia(m[1], el.offsetWidth || 0, el.offsetHeight || 0);
      }
    }
  });

  return Array.from(mediaMap.values());
})();
