const extAPI = typeof browser !== 'undefined' ? browser : chrome;

extAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'start_downloads') {
    processBackgroundDownloads(message.items, message.logContent, message.folderName);
    sendResponse({ status: "started" });
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

async function processBackgroundDownloads(items, logContent, folderName) {
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const startTime = Date.now();
    let finalFilename = item.filename;

    if (finalFilename.endsWith('.unknown')) {
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
      
      if (logContent) {
         logContent = logContent.replace(`File: ${item.filename.split('/').pop()}`, `File: ${finalFilename.split('/').pop()}`);
      }
    }

    try {
      await extAPI.downloads.download({
        url: item.url,
        filename: finalFilename,
        saveAs: false
      });
    } catch (err) {
      console.error(`Failed to background download ${item.url}`, err);
      if (logContent) {
        logContent = logContent.replace(
           `File: ${finalFilename.split('/').pop()}`, 
           `[FAILED: ${err.message}] File: ${finalFilename.split('/').pop()}`
        );
      }
    }

    if (i < items.length - 1) {
      const elapsed = Date.now() - startTime;
      if (elapsed < 200) {
        await new Promise(r => setTimeout(r, 200 - elapsed));
      }
    }
  }

  if (logContent && items.length > 0) {
    try {
      const isFirefox = typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('firefox');
      
      if (isFirefox) {
        // Firefox specifically blocks downloading data: URIs for security, but fully supports Blob URIs in background scripts
        const blob = new Blob([logContent], { type: 'text/plain' });
        const txtUrl = URL.createObjectURL(blob);
        
        await extAPI.downloads.download({
          url: txtUrl,
          filename: `${folderName}/_export_log.txt`,
          saveAs: false
        });
        
        setTimeout(() => URL.revokeObjectURL(txtUrl), 5000);
      } else {
        // Chrome MV3 Service Workers cannot use Blobs for downloads, but fully support base64 data: URIs
        const b64 = utf8ToBase64(logContent);
        const dataUrl = `data:text/plain;charset=utf-8;base64,${b64}`;
        
        await extAPI.downloads.download({
          url: dataUrl,
          filename: `${folderName}/_export_log.txt`,
          saveAs: false
        });
      }
    } catch (err) {
      console.error('Failed to save background export log', err);
    }
  }
}
