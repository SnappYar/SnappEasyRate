document.addEventListener('DOMContentLoaded', () => {
  const settingsBtn = document.getElementById('settingsBtn');
  if (!settingsBtn) return;

  settingsBtn.addEventListener('click', async () => {
    // Open options page in a new tab
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      const optionsUrl = chrome.runtime.getURL('options.html');
      await chrome.tabs.create({ url: optionsUrl });
    }
    window.close();
  });
});

