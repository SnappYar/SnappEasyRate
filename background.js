// Handle CORS-sensitive fetches from content scripts
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'SF_FETCH') return;
  (async () => {
    try {
      const res = await fetch(msg.url, {
        method: msg.method || 'GET',
        headers: msg.headers || {},
        body: msg.body ? JSON.stringify(msg.body) : undefined,
      });
      const text = await res.text();
      sendResponse({ ok: res.ok, status: res.status, text });
    } catch (e) {
      sendResponse({ ok: false, status: 0, error: String(e) });
    }
  })();
  return true; // async response
});


