(function (root) {
  "use strict";

  // This file is intentionally a classic script. MV3 service workers and the
  // popup/options pages both load it without requiring a bundler or Firefox
  // specific APIs.
  const DEFAULT_EXTENSION_SETTINGS = {
    enabled: true,
    port: 7899,
    autoIntercept: true,
    interceptPatterns: [
      "*.zip", "*.rar", "*.7z", "*.tar", "*.gz", "*.bz2",
      "*.exe", "*.msi", "*.dmg", "*.pkg", "*.deb", "*.rpm", "*.appimage",
      "*.mp4", "*.mkv", "*.avi", "*.mov", "*.webm", "*.m4v",
      "*.mp3", "*.flac", "*.wav", "*.m4a", "*.aac", "*.ogg",
      "*.pdf", "*.doc", "*.docx", "*.xls", "*.xlsx", "*.ppt", "*.pptx",
      "*.iso", "*.img"
    ],
    disabledSites: [],
    // Older/private builds called the disabled-site list a whitelist. Keep
    // reading it as a compatibility alias, but always normalize it.
    whitelist: [],
    fallbackToBrowser: true,
    showNotifications: true,
    defaultQueueId: null,
    theme: "system"
  };

  const MIME_EXTENSIONS = {
    "application/zip": "zip",
    "application/x-rar-compressed": "rar",
    "application/x-7z-compressed": "7z",
    "application/x-tar": "tar",
    "application/gzip": "gz",
    "application/x-bzip2": "bz2",
    "application/x-msdownload": "exe",
    "application/x-msi": "msi",
    "application/x-apple-diskimage": "dmg",
    "application/x-iso9660-image": "iso",
    "application/pdf": "pdf",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.ms-excel": "xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "application/vnd.ms-powerpoint": "ppt",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
    "video/mp4": "mp4",
    "video/x-matroska": "mkv",
    "video/x-msvideo": "avi",
    "video/quicktime": "mov",
    "video/webm": "webm",
    "audio/mpeg": "mp3",
    "audio/flac": "flac",
    "audio/wav": "wav",
    "audio/mp4": "m4a",
    "audio/aac": "aac",
    "audio/ogg": "ogg"
  };

  function unique(values) {
    return [...new Set(values.filter(Boolean))];
  }

  function parseUrl(value) {
    if (typeof value !== "string" || !value.trim()) return null;
    const text = value.trim();
    try {
      return new URL(text);
    } catch {
      try {
        return new URL(`https://${text.replace(/^\/\//, "")}`);
      } catch {
        return null;
      }
    }
  }

  function hostnameFrom(value) {
    if (typeof value !== "string" || !value.trim()) return "";
    const text = value.trim();
    const parsed = parseUrl(text);
    if (parsed?.hostname) return parsed.hostname.toLowerCase().replace(/\.$/, "");
    return "";
  }

  function normalizeSiteRule(value) {
    if (typeof value !== "string") return "";
    let text = value.trim().toLowerCase();
    if (!text) return "";
    const wildcard = text.startsWith("*.");
    if (wildcard) text = text.slice(2);
    const hostname = hostnameFrom(text);
    if (!hostname || /[/?#]/.test(hostname)) return "";
    return `${wildcard ? "*." : ""}${hostname}`;
  }

  function registrableDomain(hostname) {
    const host = hostname.toLowerCase().replace(/^www\./, "");
    if (!host || host === "localhost" || /^[\d.]+$/.test(host) || host.includes(":")) return host;
    const labels = host.split(".").filter(Boolean);
    if (labels.length <= 2) return host;
    const twoPartSuffixes = new Set([
      "co.uk", "org.uk", "ac.uk", "gov.uk", "com.au", "net.au", "org.au",
      "co.in", "firm.in", "net.in", "org.in", "co.jp", "com.br", "com.cn",
      "com.mx", "co.nz", "co.za"
    ]);
    const suffix = labels.slice(-2).join(".");
    return twoPartSuffixes.has(suffix) ? labels.slice(-3).join(".") : labels.slice(-2).join(".");
  }

  function normalizeWhitelistEntry(value) {
    const rule = normalizeSiteRule(value);
    if (!rule) return "";
    if (rule.startsWith("*.")) return rule;
    const base = registrableDomain(rule);
    if (!base) return "";
    if (base === "localhost" || base.includes(":") || /^[\d.]+$/.test(base) || !base.includes(".")) return base;
    return `*.${base}`;
  }

  function normalizeSiteList(values, whitelist) {
    if (!Array.isArray(values)) return [];
    return unique(values.map(value => whitelist ? normalizeWhitelistEntry(value) : normalizeSiteRule(value)));
  }

  function normalizeFilePattern(value) {
    if (typeof value !== "string") return "";
    let pattern = value.trim().toLowerCase();
    if (!pattern) return "";
    if (pattern.startsWith(".")) pattern = `*${pattern}`;
    else if (!pattern.includes("*") && !pattern.includes("?") && !pattern.includes(".")) pattern = `*.${pattern}`;
    return pattern;
  }

  function normalizeFilePatterns(values) {
    return unique((Array.isArray(values) ? values : []).map(normalizeFilePattern));
  }

  function normalizeSettings(value) {
    const incoming = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    return {
      ...DEFAULT_EXTENSION_SETTINGS,
      ...incoming,
      interceptPatterns: normalizeFilePatterns(incoming.interceptPatterns ?? DEFAULT_EXTENSION_SETTINGS.interceptPatterns),
      disabledSites: normalizeSiteList(incoming.disabledSites ?? DEFAULT_EXTENSION_SETTINGS.disabledSites, false),
      whitelist: normalizeSiteList(incoming.whitelist ?? DEFAULT_EXTENSION_SETTINGS.whitelist, true)
    };
  }

  function siteMatches(hostname, rule) {
    const host = hostnameFrom(hostname);
    const normalized = normalizeSiteRule(rule);
    if (!host || !normalized) return false;
    if (normalized.startsWith("*.")) {
      const base = normalized.slice(2);
      return host === base || host.endsWith(`.${base}`);
    }
    // Treat www.example.com and example.com as the same site, but do not
    // broaden an ordinary exact hostname to unrelated subdomains.
    return host === normalized || host.replace(/^www\./, "") === normalized.replace(/^www\./, "");
  }

  function isSiteDisabled(url, disabledSites, whitelist) {
    const hostname = hostnameFrom(url);
    if (!hostname) return false;
    return [...(Array.isArray(disabledSites) ? disabledSites : []), ...(Array.isArray(whitelist) ? whitelist : [])]
      .some(rule => siteMatches(hostname, rule));
  }

  function wildcardRegex(pattern) {
    const escaped = pattern.replace(/[|\\{}()[\]^$+\-.]/g, "\\$&");
    return new RegExp(`^${escaped.replace(/\*/g, ".*").replace(/\?/g, ".")}$`, "i");
  }

  function urlPath(value) {
    const parsed = parseUrl(value);
    return parsed ? parsed.pathname : "";
  }

  function filenameFrom(value) {
    if (typeof value !== "string" || !value) return "";
    const clean = value.split(/[?#]/, 1)[0].replace(/\\/g, "/");
    return clean.slice(clean.lastIndexOf("/") + 1);
  }

  function mimeExtension(mime) {
    if (typeof mime !== "string") return "";
    const type = mime.toLowerCase().split(";", 1)[0].trim();
    return MIME_EXTENSIONS[type] || "";
  }

  function matchesFilePatterns(url, filename, mime, patterns) {
    const normalizedPatterns = normalizeFilePatterns(patterns);
    if (normalizedPatterns.length === 0) return false;
    const path = urlPath(url);
    const candidates = unique([path, filename, filenameFrom(path), filenameFrom(filename)]);
    const mimeExt = mimeExtension(mime);
    if (mimeExt) candidates.push(`download.${mimeExt}`);
    return normalizedPatterns.some(pattern => {
      const regex = wildcardRegex(pattern);
      return candidates.some(candidate => regex.test(candidate) || regex.test(filenameFrom(candidate)));
    });
  }

  const api = {
    DEFAULT_EXTENSION_SETTINGS,
    normalizeSettings,
    normalizeSiteRule,
    normalizeWhitelistEntry,
    normalizeFilePattern,
    normalizeFilePatterns,
    siteMatches,
    isSiteDisabled,
    matchesFilePatterns,
    hostnameFrom
  };

  root.DLManRules = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;

  // The packaged UI and the legacy background bundle both use the same
  // `settings` storage key. Normalize at the API boundary so old malformed
  // values cannot be reintroduced by either surface.
  try {
    const extensionApi = root.browser || root.chrome;
    const area = extensionApi?.storage?.local;
    if (area && !area.__dlmanRulesPatched) {
      const originalGet = area.get.bind(area);
      const originalSet = area.set.bind(area);
      area.get = (keys, ...args) => {
        const result = originalGet(keys, ...args);
        if (result && typeof result.then === "function") {
          return result.then(values => values?.settings === undefined ? values : {
            ...values,
            settings: normalizeSettings(values.settings)
          });
        }
        return result;
      };
      area.set = (items, ...args) => {
        if (items && Object.prototype.hasOwnProperty.call(items, "settings")) {
          items = { ...items, settings: normalizeSettings(items.settings) };
        }
        return originalSet(items, ...args);
      };
      if (area.onChanged?.addListener) {
        const originalChangedAdd = area.onChanged.addListener.bind(area.onChanged);
        area.onChanged.addListener = (callback, ...args) => originalChangedAdd((changes, ...changeArgs) => {
          if (changes?.settings?.newValue !== undefined) {
            changes = {
              ...changes,
              settings: {
                ...changes.settings,
                newValue: normalizeSettings(changes.settings.newValue)
              }
            };
          }
          return callback(changes, ...changeArgs);
        }, ...args);
      }
      Object.defineProperty(area, "__dlmanRulesPatched", { value: true });
    }
  } catch (error) {
    // Storage may not exist when this file is evaluated in a unit test.
  }
})(typeof globalThis !== "undefined" ? globalThis : self);
