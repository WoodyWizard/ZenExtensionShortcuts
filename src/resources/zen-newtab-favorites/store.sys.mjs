/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Favorites storage for the Zen new tab favorites mod.
//
// Favorites live in a regular bookmarks folder under "Other Bookmarks", so they
// sync through a Mozilla account and can also be edited in the Library window.
// The module is loaded once per browser session and shared by all windows.

const { PlacesUtils } = ChromeUtils.importESModule(
  "resource://gre/modules/PlacesUtils.sys.mjs"
);
const { setTimeout } = ChromeUtils.importESModule(
  "resource://gre/modules/Timer.sys.mjs"
);

const FOLDER_GUID_PREF = "zenFavorites.folderGuid";
const FOLDER_TITLE = "Избранное новой вкладки";
const PLACES_EVENTS = [
  "bookmark-added",
  "bookmark-removed",
  "bookmark-moved",
  "bookmark-title-changed",
  "bookmark-url-changed",
];

let folderGuidPromise = null;
const listeners = new Set();
let notifyTimer = null;

async function isUsableFolder(guid) {
  if (!guid) {
    return false;
  }
  const item = await PlacesUtils.bookmarks.fetch(guid);
  return item?.type == PlacesUtils.bookmarks.TYPE_FOLDER;
}

async function findOrCreateFolder() {
  const saved = Services.prefs.getStringPref(FOLDER_GUID_PREF, "");
  if (await isUsableFolder(saved)) {
    return saved;
  }

  // The pref is per profile but bookmarks sync, so a folder created on another
  // device may already be here. Reuse it instead of creating a duplicate.
  const matches = await PlacesUtils.bookmarks.search({ title: FOLDER_TITLE });
  const existing = matches.find(
    b =>
      b.type == PlacesUtils.bookmarks.TYPE_FOLDER &&
      b.parentGuid == PlacesUtils.bookmarks.unfiledGuid
  );
  const folder =
    existing ??
    (await PlacesUtils.bookmarks.insert({
      parentGuid: PlacesUtils.bookmarks.unfiledGuid,
      type: PlacesUtils.bookmarks.TYPE_FOLDER,
      title: FOLDER_TITLE,
    }));
  Services.prefs.setStringPref(FOLDER_GUID_PREF, folder.guid);
  return folder.guid;
}

function folderGuid() {
  folderGuidPromise ??= findOrCreateFolder().catch(e => {
    folderGuidPromise = null;
    throw e;
  });
  return folderGuidPromise;
}

async function onPlacesEvents(events) {
  let guid;
  try {
    guid = await folderGuid();
  } catch {
    return;
  }
  const relevant = events.some(
    e => e.parentGuid == guid || e.oldParentGuid == guid || e.guid == guid
  );
  if (!relevant) {
    return;
  }
  if (events.some(e => e.type == "bookmark-removed" && e.guid == guid)) {
    // The folder itself was deleted; a new one is created on next access.
    folderGuidPromise = null;
  }
  // Batch bursts of events (e.g. a reorder moves every child) into one update.
  if (!notifyTimer) {
    notifyTimer = setTimeout(() => {
      notifyTimer = null;
      for (const listener of listeners) {
        try {
          listener();
        } catch (e) {
          console.error("[ZenFavorites] listener failed", e);
        }
      }
    }, 30);
  }
}

/**
 * Turns user input like "github.com" or "https://github.com/x" into a URL string.
 * Returns null when the input does not look like a web address.
 */
function normalizeUrl(input) {
  let text = String(input ?? "").trim();
  if (!text) {
    return null;
  }
  if (!/^[a-z][a-z0-9+.-]*:/i.test(text)) {
    text = "https://" + text;
  }
  let url;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol == "http:" || url.protocol == "https:") {
    const host = url.hostname;
    if (!host || (!host.includes(".") && host != "localhost")) {
      return null;
    }
  } else if (!["file:", "about:", "moz-extension:"].includes(url.protocol)) {
    return null;
  }
  return url.href;
}

function defaultTitle(url) {
  try {
    const { hostname } = new URL(url);
    return hostname.replace(/^www\./, "") || url;
  } catch {
    return url;
  }
}

export const ZenFavoritesStore = {
  FOLDER_TITLE,
  normalizeUrl,
  defaultTitle,

  async list() {
    const guid = await folderGuid();
    const tree = await PlacesUtils.promiseBookmarksTree(guid);
    return (tree?.children ?? [])
      .filter(child => child.uri)
      .map(child => ({
        guid: child.guid,
        url: child.uri,
        title: child.title || defaultTitle(child.uri),
      }));
  },

  async add({ title, url }) {
    const parentGuid = await folderGuid();
    return PlacesUtils.bookmarks.insert({
      parentGuid,
      url,
      title: title || defaultTitle(url),
    });
  },

  async update(guid, { title, url }) {
    return PlacesUtils.bookmarks.update({
      guid,
      url,
      title: title || defaultTitle(url),
    });
  },

  async remove(guid) {
    return PlacesUtils.bookmarks.remove(guid);
  },

  async reorder(orderedGuids) {
    const parentGuid = await folderGuid();
    return PlacesUtils.bookmarks.reorder(parentGuid, orderedGuids);
  },

  /**
   * Returns an icon URL for the page: the favicon Places stored for it, or the
   * site's /favicon.ico when it was never visited in this profile. Null for
   * non-web URLs. The caller falls back to a letter if the image fails to load.
   */
  async iconFor(url) {
    try {
      const favicon = await PlacesUtils.favicons.getFaviconForPage(
        Services.io.newURI(url),
        64
      );
      if (favicon) {
        return "page-icon:" + url;
      }
    } catch {}
    try {
      const { protocol, origin } = new URL(url);
      if (protocol == "https:" || protocol == "http:") {
        return origin + "/favicon.ico";
      }
    } catch {}
    return null;
  },

  addListener(listener) {
    if (!listeners.size) {
      PlacesUtils.observers.addListener(PLACES_EVENTS, onPlacesEvents);
    }
    listeners.add(listener);
  },

  removeListener(listener) {
    listeners.delete(listener);
    if (!listeners.size) {
      PlacesUtils.observers.removeListener(PLACES_EVENTS, onPlacesEvents);
    }
  },
};
