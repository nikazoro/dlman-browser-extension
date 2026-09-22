// Install the policy gate before the packaged background registers its
// listeners. This keeps the existing service-worker implementation intact
// while making every interception entry point pass through the same rules.
importScripts("rule-utils.js");

(function installPolicyGate() {
  "use strict";

  const rules = globalThis.DLManRules;
  const settingsKey = "settings";
  let settingsPromise;

  async function getSettings() {
    try {
      const result = await chrome.storage.local.get(settingsKey);
      return rules.normalizeSettings(result?.[settingsKey]);
    } catch (error) {
      console.error("[DLMan] Could not read settings before interception", error);
      return null;
    }
  }

  function cachedSettings() {
    if (!settingsPromise) {
      settingsPromise = getSettings();
      settingsPromise.finally(() => { settingsPromise = null; });
    }
    return settingsPromise;
  }

  async function disabledFor(settings, primaryUrl, referrer) {
    if (!settings) return true;
    return rules.isSiteDisabled(primaryUrl, settings.disabledSites, settings.whitelist) ||
      rules.isSiteDisabled(referrer, settings.disabledSites, settings.whitelist);
  }

  function wrapEvent(event, callbackFactory) {
    const original = event.addListener.bind(event);
    event.addListener = (callback, ...args) => original(callbackFactory(callback), ...args);
  }

  wrapEvent(chrome.downloads.onCreated, callback => async item => {
    const settings = await cachedSettings();
    const url = item?.finalUrl || item?.url || "";
    if (!settings || await disabledFor(settings, url, item?.referrer) ||
        !rules.matchesFilePatterns(url, item?.filename, item?.mime, settings.interceptPatterns)) return;
    return callback(item);
  });

  wrapEvent(chrome.contextMenus.onClicked, callback => async (info, tab) => {
    if (info?.menuItemId !== "toggle-site") {
      const settings = await cachedSettings();
      if (await disabledFor(settings, info?.linkUrl || info?.srcUrl || tab?.url, tab?.url)) return;
    }
    return callback(info, tab);
  });

  wrapEvent(chrome.runtime.onMessage, callback => (message, sender, sendResponse) => {
    const guardedTypes = new Set(["add-download", "all-links", "media-detected", "media-download"]);
    if (!guardedTypes.has(message?.type)) return callback(message, sender, sendResponse);

    (async () => {
      const settings = await cachedSettings();
      const media = message?.request?.media;
      const primary = message?.url || media?.master_url || sender?.tab?.url;
      const referrer = message?.referrer || media?.referrer || sender?.tab?.url;
      if (await disabledFor(settings, primary, referrer)) {
        if (message?.type === "media-download" || message?.type === "add-download") {
          sendResponse({ success: false, error: "DLMan is disabled on this site" });
        }
        return;
      }
      if (message?.type === "all-links" && Array.isArray(message.links)) {
        const links = [];
        for (const link of message.links) {
          if (!(await disabledFor(settings, link, sender?.tab?.url))) links.push(link);
        }
        if (links.length === 0) return;
        message = { ...message, links };
      }
      callback(message, sender, sendResponse);
    })().catch(error => {
      console.error("[DLMan] Policy gate failed", error);
      if (message?.type === "media-download" || message?.type === "add-download") {
        sendResponse({ success: false, error: "Could not verify site settings" });
      }
    });
    return true;
  });

  for (const event of [chrome.webRequest.onBeforeRequest, chrome.webRequest.onHeadersReceived]) {
    if (!event) continue;
    wrapEvent(event, callback => async request => {
      const settings = await cachedSettings();
      let pageUrl = "";
      if (request?.tabId >= 0) {
        try { pageUrl = (await chrome.tabs.get(request.tabId))?.url || ""; } catch {}
      }
      if (await disabledFor(settings, request?.url, pageUrl)) return;
      return callback(request);
    });
  }

  // Normalize settings written by the legacy bundle and by older builds.
  const originalSet = chrome.storage.local.set.bind(chrome.storage.local);
  chrome.storage.local.set = (items, ...args) => {
    if (items && Object.prototype.hasOwnProperty.call(items, settingsKey)) {
      items = { ...items, [settingsKey]: rules.normalizeSettings(items[settingsKey]) };
    }
    return originalSet(items, ...args);
  };

  // The selected-links context-menu path asks the content script for links
  // and then sends the returned array directly to the batch API. Filter that
  // response here so a cross-site link cannot bypass the page-level gate.
  const originalSendMessage = chrome.tabs.sendMessage.bind(chrome.tabs);
  chrome.tabs.sendMessage = (tabId, message, ...args) => {
    if (message?.type !== "get-selected-links") return originalSendMessage(tabId, message, ...args);
    const filterResponse = async response => {
      const settings = await cachedSettings();
      let pageUrl = "";
      try { pageUrl = (await chrome.tabs.get(tabId))?.url || ""; } catch {}
      const links = [];
      for (const link of response?.links || []) {
        if (!(await disabledFor(settings, link, pageUrl))) links.push(link);
      }
      return { ...(response || {}), links };
    };
    const callback = typeof args[args.length - 1] === "function" ? args.pop() : null;
    if (callback) {
      args.push(response => { filterResponse(response).then(callback).catch(() => callback({ links: [] })); });
      return originalSendMessage(tabId, message, ...args);
    }
    return Promise.resolve(originalSendMessage(tabId, message, ...args)).then(filterResponse);
  };
})();

importScripts("background.js");
