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
    let candidates = [];
    const src = img.src;

    // Estimate aspect ratio and fallback dimensions
    let fallbackW = img.naturalWidth || img.width || (src && src.startsWith('data:') ? img.offsetWidth : 800);
    let fallbackH = img.naturalHeight || img.height || (src && src.startsWith('data:') ? img.offsetHeight : 800);
    const aspect = (fallbackH && fallbackW) ? (fallbackH / fallbackW) : 1;

    // A. Add currentSrc
    if (img.currentSrc) {
      candidates.push({
        url: img.currentSrc,
        w: img.naturalWidth || img.width || 0,
        h: img.naturalHeight || img.height || 0
      });
    }

    // B. Add base src
    if (src) {
      const w = img.naturalWidth || img.width || (src.startsWith('data:') ? img.offsetWidth : 0);
      const h = img.naturalHeight || img.height || (src.startsWith('data:') ? img.offsetHeight : 0);
      candidates.push({ url: src, w: w, h: h });
    }

    // C. Direct img tag srcsets
    if (img.srcset) {
      const best = getLargestSrcset(img.srcset, fallbackW);
      if (best && best.url) {
        const a = document.createElement('a');
        a.href = best.url;
        let w = best.w > 0 ? best.w : fallbackW;
        let h = Math.round(w * aspect);
        candidates.push({ url: a.href, w: w, h: h });
      }
    }
    
    // D. HTML5 picture sibling source tags
    if (img.parentElement && img.parentElement.tagName.toLowerCase() === 'picture') {
      img.parentElement.querySelectorAll('source').forEach(source => {
        if (source.srcset) {
          const best = getLargestSrcset(source.srcset, fallbackW);
          if (best && best.url) {
            const a = document.createElement('a');
            a.href = best.url;
            let w = best.w > 0 ? best.w : fallbackW;
            let h = Math.round(w * aspect);
            candidates.push({ url: a.href, w: w, h: h });
          }
        }
      });
    }

    // Pick the one with the maximum width
    let bestCandidate = null;
    let maxW = -1;
    for (const c of candidates) {
      if (!c.url || c.url.startsWith('chrome-extension://') || c.url.startsWith('moz-extension://')) continue;
      // remove fragments
      c.url = c.url.split('#')[0];
      if (c.url.length === 0) continue;

      if (c.w > maxW) {
        maxW = c.w;
        bestCandidate = c;
      }
    }

    // Emit only the best candidate for this element
    if (bestCandidate) {
      addMedia(bestCandidate.url, bestCandidate.w, bestCandidate.h);
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
