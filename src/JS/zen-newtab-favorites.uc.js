// ==UserScript==
// @name           Zen new tab favorites
// @description    Favorites panel under Zen's floating new tab URL bar
// @version        1.0.0
// ==/UserScript==

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

(() => {
  "use strict";

  const { ZenFavoritesStore: Store } = ChromeUtils.importESModule(
    "chrome://userchrome/content/zen-newtab-favorites/store.sys.mjs"
  );

  const HTML_NS = "http://www.w3.org/1999/xhtml";
  const WIDTH_PREF = "zenFavorites.urlbarWidth";
  const DEFAULT_WIDTH = 900;
  const HOTKEY_COUNT = 9;
  const DRAG_THRESHOLD = 5;

  const TEXT = {
    title: "Избранное",
    edit: "Редактировать",
    done: "Готово",
    add: "Добавить",
    remove: "Удалить",
    newSite: "Новый сайт",
    editSite: "Изменить сайт",
    name: "Название",
    address: "Адрес",
    save: "Сохранить",
    cancel: "Отмена",
    noUrl: "Укажите адрес сайта.",
    badUrl: "Похоже, это не адрес сайта. Пример: example.com",
    saveFailed: "Не получилось сохранить. Попробуйте ещё раз.",
  };

  function h(tag, attrs = {}, ...children) {
    const el = document.createElementNS(HTML_NS, tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value === false || value == null) {
        continue;
      }
      if (key == "class") {
        el.className = value;
      } else if (key == "text") {
        el.textContent = value;
      } else {
        el.setAttribute(key, value === true ? "" : value);
      }
    }
    el.append(...children);
    return el;
  }

  function hueFor(text) {
    let hue = 0;
    for (const ch of text) {
      hue = (hue * 31 + ch.codePointAt(0)) % 360;
    }
    return hue;
  }

  function hostOf(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return url;
    }
  }

  class FavoritesPanel {
    urlbar = gURLBar;
    items = [];
    editing = false;
    // undefined: no form; null: adding a new site; string: guid being edited.
    formTarget = undefined;
    drag = null;
    suppressClick = false;
    pendingRefresh = false;
    refreshToken = 0;

    constructor() {
      this.build();
      this.urlbar.append(this.panel);

      this.applyWidthPref();
      Services.prefs.addObserver(WIDTH_PREF, this);

      this.onStoreChange = () => this.refresh();
      Store.addListener(this.onStoreChange);

      this.attrObserver = new MutationObserver(() => this.syncVisibility());
      this.attrObserver.observe(this.urlbar, {
        attributes: true,
        attributeFilter: ["zen-newtab", "zen-floating-urlbar", "breakout-extend"],
      });
      this.sizeObserver = new ResizeObserver(() => this.updateHeightVar());
      this.sizeObserver.observe(this.panel);

      for (const type of [
        "mousedown",
        "click",
        "auxclick",
        "pointerdown",
        "pointermove",
        "pointerup",
        "pointercancel",
        "keydown",
        "input",
        "focusout",
      ]) {
        this.panel.addEventListener(type, this);
      }
      // Capturing blur lets us keep the URL bar open while an edit field has focus.
      window.addEventListener("blur", this, true);
      this.urlbar.inputField.addEventListener("keydown", this, true);
      window.addEventListener("unload", () => this.destroy(), { once: true });

      this.shown = false;
      this.refresh();
    }

    destroy() {
      Store.removeListener(this.onStoreChange);
      Services.prefs.removeObserver(WIDTH_PREF, this);
      this.attrObserver.disconnect();
      this.sizeObserver.disconnect();
    }

    // ---- DOM -----------------------------------------------------------------

    build() {
      this.editToggle = h("button", { class: "zfav-edit-toggle", type: "button" });
      this.grid = h("div", { class: "zfav-grid" });

      this.formTitle = h("div", { class: "zfav-form-title" });
      this.nameInput = h("input", {
        class: "zfav-input",
        type: "text",
        placeholder: TEXT.name,
        "aria-label": TEXT.name,
      });
      this.urlInput = h("input", {
        class: "zfav-input zfav-input-url",
        type: "text",
        placeholder: "example.com",
        "aria-label": TEXT.address,
        spellcheck: "false",
      });
      this.saveButton = h("button", {
        class: "zfav-button zfav-button-primary",
        type: "button",
        text: TEXT.save,
      });
      this.cancelButton = h("button", {
        class: "zfav-button",
        type: "button",
        text: TEXT.cancel,
      });
      this.error = h("div", { class: "zfav-error", role: "alert" });
      this.form = h(
        "div",
        { class: "zfav-form", hidden: true },
        this.formTitle,
        h(
          "div",
          { class: "zfav-form-row" },
          this.nameInput,
          this.urlInput,
          this.saveButton,
          this.cancelButton
        ),
        this.error
      );

      this.panel = h(
        "div",
        { id: "zfav-panel" },
        h(
          "div",
          { class: "zfav-header" },
          h("span", { class: "zfav-title", text: TEXT.title }),
          this.editToggle
        ),
        this.grid,
        this.form
      );
    }

    render() {
      const tiles = this.items.map((item, index) => this.renderTile(item, index));
      if (this.editing || !this.items.length) {
        tiles.push(this.renderAddTile());
      }
      this.grid.replaceChildren(...tiles);

      this.panel.toggleAttribute("editing", this.editing);
      this.panel.toggleAttribute("empty", !this.items.length);
      const toggleLabel = this.editing ? TEXT.done : TEXT.edit;
      this.editToggle.setAttribute("title", toggleLabel);
      this.editToggle.setAttribute("aria-label", toggleLabel);
      this.editToggle.toggleAttribute("checked", this.editing);

      const formOpen = this.formTarget !== undefined;
      this.form.hidden = !formOpen;
      if (formOpen) {
        this.formTitle.textContent = this.formTarget ? TEXT.editSite : TEXT.newSite;
      }
    }

    renderTile(item, index) {
      const icon = h("span", { class: "zfav-icon" });
      if (item.icon) {
        const img = h("img", { src: item.icon, alt: "" });
        img.addEventListener("error", () => this.showLetter(icon, item), { once: true });
        icon.append(img);
      } else {
        this.showLetter(icon, item);
      }
      return h(
        "div",
        {
          class: "zfav-tile",
          role: "button",
          "data-guid": item.guid,
          title: item.url,
          "aria-label": item.title,
          selected: this.formTarget == item.guid,
        },
        icon,
        h("span", { class: "zfav-label", text: item.title }),
        h("span", {
          class: "zfav-key",
          text: index < HOTKEY_COUNT ? `Alt+${index + 1}` : "",
        }),
        h("span", {
          class: "zfav-remove",
          role: "button",
          title: TEXT.remove,
          "aria-label": `${TEXT.remove}: ${item.title}`,
        })
      );
    }

    showLetter(icon, item) {
      const host = hostOf(item.url);
      icon.replaceChildren();
      icon.classList.add("zfav-letter");
      icon.style.setProperty("--zfav-hue", hueFor(host));
      icon.textContent = (item.title || host).trim().charAt(0).toUpperCase();
    }

    renderAddTile() {
      return h(
        "div",
        { class: "zfav-tile zfav-add", role: "button", title: TEXT.add },
        h("span", { class: "zfav-icon" }),
        h("span", { class: "zfav-label", text: TEXT.add }),
        h("span", { class: "zfav-key" })
      );
    }

    updateKeyLabels() {
      this.grid.querySelectorAll(".zfav-tile[data-guid] .zfav-key").forEach((el, i) => {
        el.textContent = i < HOTKEY_COUNT ? `Alt+${i + 1}` : "";
      });
    }

    // ---- State -----------------------------------------------------------------

    get isShown() {
      return (
        this.urlbar.hasAttribute("zen-newtab") &&
        this.urlbar.getAttribute("zen-floating-urlbar") == "true" &&
        this.urlbar.hasAttribute("breakout-extend")
      );
    }

    syncVisibility() {
      const shown = this.isShown;
      if (shown == this.shown) {
        return;
      }
      this.shown = shown;
      if (shown) {
        // Icons appear once a site is visited, so pick up new ones on every open.
        this.refresh();
      } else {
        this.editing = false;
        this.formTarget = undefined;
        this.cancelDrag();
        this.render();
      }
    }

    async refresh() {
      const token = ++this.refreshToken;
      let items;
      try {
        items = await Store.list();
        const icons = await Promise.all(items.map(item => Store.iconFor(item.url)));
        items.forEach((item, i) => (item.icon = icons[i]));
      } catch (e) {
        console.error("[ZenFavorites] failed to load favorites", e);
        return;
      }
      if (token != this.refreshToken) {
        return;
      }
      if (this.drag) {
        this.pendingRefresh = true;
        return;
      }
      this.items = items;
      if (this.formTarget && !items.some(item => item.guid == this.formTarget)) {
        this.formTarget = undefined;
      }
      this.render();
    }

    setEditing(editing) {
      this.editing = editing;
      if (!editing) {
        this.closeForm();
      } else {
        this.render();
      }
    }

    openForm(guid) {
      this.formTarget = guid;
      const item = guid ? this.items.find(i => i.guid == guid) : null;
      this.nameInput.value = item?.title ?? "";
      this.urlInput.value = item?.url ?? "";
      this.setError("");
      this.render();
      (guid ? this.nameInput : this.urlInput).focus();
    }

    closeForm() {
      const hadFocus = this.panel.contains(document.activeElement);
      this.formTarget = undefined;
      this.setError("");
      this.render();
      if (hadFocus && this.isShown) {
        this.urlbar.inputField.focus();
      }
    }

    setError(message, field) {
      this.error.textContent = message;
      this.nameInput.removeAttribute("aria-invalid");
      this.urlInput.removeAttribute("aria-invalid");
      if (field) {
        field.setAttribute("aria-invalid", "true");
        field.focus();
      }
    }

    async saveForm() {
      if (!this.urlInput.value.trim()) {
        this.setError(TEXT.noUrl, this.urlInput);
        return;
      }
      const url = Store.normalizeUrl(this.urlInput.value);
      if (!url) {
        this.setError(TEXT.badUrl, this.urlInput);
        return;
      }
      const title = this.nameInput.value.trim();
      try {
        if (this.formTarget) {
          await Store.update(this.formTarget, { title, url });
        } else {
          await Store.add({ title, url });
        }
      } catch (e) {
        console.error("[ZenFavorites] failed to save", e);
        this.setError(TEXT.saveFailed);
        return;
      }
      this.closeForm();
    }

    async remove(guid) {
      if (this.formTarget == guid) {
        this.closeForm();
      }
      try {
        await Store.remove(guid);
      } catch (e) {
        console.error("[ZenFavorites] failed to remove", e);
      }
    }

    openItem(guid, event, where) {
      const item = this.items.find(i => i.guid == guid);
      if (!item) {
        return;
      }
      if (!where) {
        where = "tab";
        try {
          where = this.urlbar.controller.whereToOpen(event);
        } catch (e) {
          console.error(e);
        }
      }
      if (where != "tabshifted") {
        // Same path Zen uses when a URL bar result is picked in new tab mode.
        this.urlbar._zenHandleUrlbarClose?.(true, true);
      }
      openTrustedLinkIn(item.url, where);
    }

    // ---- Events ----------------------------------------------------------------

    observe(_subject, topic, data) {
      if (topic == "nsPref:changed" && data == WIDTH_PREF) {
        this.applyWidthPref();
      }
    }

    applyWidthPref() {
      const width = Services.prefs.getIntPref(WIDTH_PREF, DEFAULT_WIDTH);
      if (width > 0) {
        document.documentElement.style.setProperty("--zfav-urlbar-width", `${width}px`);
      } else {
        document.documentElement.style.removeProperty("--zfav-urlbar-width");
      }
    }

    updateHeightVar() {
      const height = this.panel.getBoundingClientRect().height;
      this.urlbar.style.setProperty("--zfav-panel-height", `${Math.round(height)}px`);
    }

    handleEvent(event) {
      switch (event.type) {
        case "mousedown":
          // Keep focus in the URL bar (or the edit field) so Zen doesn't close it.
          if (!event.target.closest(".zfav-input")) {
            event.preventDefault();
          }
          break;
        case "click":
          this.onClick(event);
          break;
        case "auxclick":
          if (event.button == 1 && !this.editing) {
            const tile = event.target.closest(".zfav-tile[data-guid]");
            if (tile) {
              this.openItem(tile.dataset.guid, event, "tabshifted");
            }
          }
          break;
        case "pointerdown":
          this.onPointerDown(event);
          break;
        case "pointermove":
          this.onPointerMove(event);
          break;
        case "pointerup":
        case "pointercancel":
          this.onPointerUp(event);
          break;
        case "keydown":
          if (event.currentTarget == this.urlbar.inputField) {
            this.onUrlbarKeyDown(event);
          } else {
            this.onFormKeyDown(event);
          }
          break;
        case "input":
          if (this.error.textContent) {
            this.setError("");
          }
          break;
        case "blur":
          this.onBlurCapture(event);
          break;
        case "focusout":
          this.onFocusOut(event);
          break;
      }
    }

    onClick(event) {
      if (event.button != 0) {
        return;
      }
      if (this.suppressClick) {
        this.suppressClick = false;
        return;
      }
      const target = event.target;
      if (target.closest(".zfav-edit-toggle")) {
        this.setEditing(!this.editing);
      } else if (target == this.saveButton) {
        this.saveForm();
      } else if (target == this.cancelButton) {
        this.closeForm();
      } else if (target.closest(".zfav-remove")) {
        this.remove(target.closest(".zfav-tile").dataset.guid);
      } else if (target.closest(".zfav-add")) {
        this.openForm(null);
      } else {
        const tile = target.closest(".zfav-tile[data-guid]");
        if (!tile) {
          return;
        }
        if (this.editing) {
          this.openForm(tile.dataset.guid);
        } else {
          this.openItem(tile.dataset.guid, event);
        }
      }
    }

    onUrlbarKeyDown(event) {
      if (!this.isShown || this.editing) {
        return;
      }
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
        return;
      }
      // event.code keeps Alt+1..9 working with any keyboard layout.
      const match = /^(?:Digit|Numpad)([1-9])$/.exec(event.code);
      const item = match && this.items[Number(match[1]) - 1];
      if (!item) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      this.openItem(item.guid, event);
    }

    onFormKeyDown(event) {
      if (!event.target.closest(".zfav-input")) {
        return;
      }
      if (event.key == "Enter") {
        event.preventDefault();
        event.stopPropagation();
        this.saveForm();
      } else if (event.key == "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.closeForm();
      }
    }

    onBlurCapture(event) {
      if (event.target != this.urlbar.inputField) {
        return;
      }
      // Focus is moving from the URL bar into our edit field. Hide this blur from
      // the URL bar, otherwise it closes itself (and Zen's new tab mode with it).
      if (event.relatedTarget && this.panel.contains(event.relatedTarget)) {
        event.stopImmediatePropagation();
      }
    }

    onFocusOut(event) {
      if (!event.target.closest?.(".zfav-input")) {
        return;
      }
      const next = event.relatedTarget;
      if (next && (this.panel.contains(next) || next == this.urlbar.inputField)) {
        return;
      }
      setTimeout(() => {
        // Switching to another app (e.g. to copy a link) keeps everything open;
        // focus comes back to the edit field when the window is reactivated.
        if (!this.isShown || !document.hasFocus()) {
          return;
        }
        const focused = document.commandDispatcher.focusedElement;
        if (focused && (this.panel.contains(focused) || focused == this.urlbar.inputField)) {
          return;
        }
        // Focus went somewhere else in the window: close like a normal URL bar blur.
        try {
          this.urlbar._on_blur(new FocusEvent("blur", { relatedTarget: focused }));
        } catch (e) {
          console.error(e);
          this.urlbar.view.close();
        }
      }, 0);
    }

    // ---- Drag to reorder ---------------------------------------------------------

    onPointerDown(event) {
      if (!this.editing || event.button != 0) {
        return;
      }
      const tile = event.target.closest(".zfav-tile[data-guid]");
      if (!tile || event.target.closest(".zfav-remove")) {
        return;
      }
      this.drag = {
        tile,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        active: false,
      };
      tile.setPointerCapture(event.pointerId);
    }

    onPointerMove(event) {
      const drag = this.drag;
      if (!drag || event.pointerId != drag.pointerId) {
        return;
      }
      if (!drag.active) {
        const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
        if (distance < DRAG_THRESHOLD) {
          return;
        }
        drag.active = true;
        const gridRect = this.grid.getBoundingClientRect();
        drag.offsetX = drag.startX - (gridRect.left + drag.tile.offsetLeft);
        drag.offsetY = drag.startY - (gridRect.top + drag.tile.offsetTop);
        drag.tile.setAttribute("dragging", "");
        this.panel.setAttribute("dragging", "");
      }

      const gridRect = this.grid.getBoundingClientRect();
      const x = event.clientX - gridRect.left;
      const y = event.clientY - gridRect.top;
      const tiles = [...this.grid.querySelectorAll(".zfav-tile[data-guid]")];
      // offsetLeft/Top ignore transforms, so tiles that are still animating
      // don't make the drop target flicker back and forth.
      const over = tiles.find(
        t =>
          t != drag.tile &&
          x >= t.offsetLeft &&
          x < t.offsetLeft + t.offsetWidth &&
          y >= t.offsetTop &&
          y < t.offsetTop + t.offsetHeight
      );
      if (over) {
        const moveAfter = tiles.indexOf(drag.tile) < tiles.indexOf(over);
        this.animateLayout(() => (moveAfter ? over.after(drag.tile) : over.before(drag.tile)), drag.tile);
      }
      const dx = x - drag.offsetX - drag.tile.offsetLeft;
      const dy = y - drag.offsetY - drag.tile.offsetTop;
      drag.tile.style.transform = `translate(${dx}px, ${dy}px)`;
    }

    onPointerUp(event) {
      const drag = this.drag;
      if (!drag || event.pointerId != drag.pointerId) {
        return;
      }
      this.drag = null;
      if (drag.tile.hasPointerCapture?.(event.pointerId)) {
        drag.tile.releasePointerCapture(event.pointerId);
      }
      if (!drag.active) {
        return;
      }
      // The click that follows pointerup belongs to the drag, not to the tile.
      this.suppressClick = true;
      setTimeout(() => (this.suppressClick = false), 0);

      const from = drag.tile.style.transform;
      drag.tile.style.transform = "";
      drag.tile.removeAttribute("dragging");
      this.panel.removeAttribute("dragging");
      if (from && event.type == "pointerup") {
        drag.tile.animate([{ transform: from }, { transform: "none" }], {
          duration: 160,
          easing: "ease-out",
        });
      }

      const order = [...this.grid.querySelectorAll(".zfav-tile[data-guid]")].map(t => t.dataset.guid);
      if (order.join() != this.items.map(i => i.guid).join()) {
        const byGuid = new Map(this.items.map(i => [i.guid, i]));
        this.items = order.map(guid => byGuid.get(guid));
        this.updateKeyLabels();
        Store.reorder(order).catch(e => {
          console.error("[ZenFavorites] failed to reorder", e);
          this.refresh();
        });
      }
      if (this.pendingRefresh) {
        this.pendingRefresh = false;
        this.refresh();
      }
    }

    cancelDrag() {
      if (!this.drag) {
        return;
      }
      this.drag.tile.style.transform = "";
      this.drag.tile.removeAttribute("dragging");
      this.panel.removeAttribute("dragging");
      this.drag = null;
    }

    // FLIP: move tiles in the DOM, then animate them from where they were.
    animateLayout(mutate, exclude) {
      const tiles = [...this.grid.children].filter(t => t != exclude);
      const before = new Map(tiles.map(t => [t, [t.offsetLeft, t.offsetTop]]));
      mutate();
      for (const tile of tiles) {
        const [x, y] = before.get(tile);
        const dx = x - tile.offsetLeft;
        const dy = y - tile.offsetTop;
        if (dx || dy) {
          tile.animate(
            [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
            { duration: 180, easing: "ease-out" }
          );
        }
      }
    }
  }

  function init() {
    if (window.gZenFavoritesPanel || !window.gURLBar?.inputField) {
      return;
    }
    try {
      window.gZenFavoritesPanel = new FavoritesPanel();
    } catch (e) {
      console.error("[ZenFavorites] init failed", e);
    }
  }

  if (window.gBrowserInit?.delayedStartupFinished) {
    init();
  } else {
    const observer = subject => {
      if (subject == window) {
        Services.obs.removeObserver(observer, "browser-delayed-startup-finished");
        init();
      }
    };
    Services.obs.addObserver(observer, "browser-delayed-startup-finished");
  }
})();
