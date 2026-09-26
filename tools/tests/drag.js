const log = [];
await openNewTab();
await sleep(1500); // let remote favicons load
const imgs = [...document.querySelectorAll("#zfav-panel .zfav-icon img")].map(i => i.src + " ok=" + (i.complete && i.naturalWidth > 0));
log.push(["icons", imgs, document.querySelectorAll("#zfav-panel .zfav-letter").length + " letters"]);

if (!gZenFavoritesPanel.editing) await click($("#zfav-panel .zfav-edit-toggle"));
const tiles = () => [...document.querySelectorAll("#zfav-panel .zfav-tile[data-guid]")];
// Drag the first tile (GitHub) onto the 4th (Gmail)
await dragTo(tiles()[0], tiles()[3]);
log.push(["after drag 0->3", state(), tiles().map(t => t.querySelector(".zfav-label").textContent)]);
await sleep(300);
const { ZenFavoritesStore: S } = ChromeUtils.importESModule("chrome://userchrome/content/zen-newtab-favorites/store.sys.mjs");
log.push(["stored order", (await S.list()).map(i => i.title)]);

// Drag the last tile back to the front
await dragTo(tiles().at(-1), tiles()[0]);
await sleep(300);
log.push(["after drag last->0", (await S.list()).map(i => i.title)]);

// A plain click on a tile in edit mode must open the form, not start a drag
await click(tiles()[1]);
log.push(["click in edit", state()]);
await click(gZenFavoritesPanel.cancelButton);
await click($("#zfav-panel .zfav-edit-toggle"));
log.push(["edit off", state()]);
return log;
