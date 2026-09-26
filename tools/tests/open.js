const log = [];
const tabInfo = () => ({
  tabs: gBrowser.tabs.length,
  selected: gBrowser.selectedBrowser.currentURI.spec,
  urlbarOpen: gURLBar.hasAttribute("breakout-extend"),
  newtab: gURLBar.hasAttribute("zen-newtab"),
  panel: getComputedStyle($("#zfav-panel")).display,
});
const labels = () => [...document.querySelectorAll("#zfav-panel .zfav-tile[data-guid] .zfav-label")].map(l => l.textContent);

// 1. Alt+2 from the URL bar
await openNewTab();
log.push(["before Alt+2", tabInfo(), labels()[1]]);
key("2", { code: "Digit2", keyCode: 50, alt: true });
await sleep(1500);
log.push(["after Alt+2", tabInfo()]);

// 2. Click a tile
await openNewTab();
const tile = [...document.querySelectorAll("#zfav-panel .zfav-tile[data-guid]")][2];
log.push(["click", tile.querySelector(".zfav-label").textContent]);
await click(tile);
await sleep(1500);
log.push(["after click", tabInfo()]);

// 3. Middle click opens in background and keeps the bar open
await openNewTab();
const before = gBrowser.tabs.length;
await click([...document.querySelectorAll("#zfav-panel .zfav-tile[data-guid]")][0], 1);
await sleep(800);
log.push(["middle click", tabInfo(), "tabs +" + (gBrowser.tabs.length - before)]);

// 4. Edit field focused, then click on the page -> everything closes
await click($("#zfav-panel .zfav-edit-toggle"));
await click($("#zfav-panel .zfav-add"));
log.push(["form open", state()]);
const content = gBrowser.selectedBrowser.getBoundingClientRect();
await click({ getBoundingClientRect: () => ({ left: content.left + 20, top: content.bottom - 40, width: 10, height: 10 }) });
await sleep(500);
log.push(["clicked page", tabInfo(), state()]);

// 5. Reopen: panel starts in view mode
await openNewTab();
log.push(["reopen", tabInfo(), state()]);

// 6. Ctrl+T while open closes it
key("t", { code: "KeyT", keyCode: 84 }); // plain t types into urlbar
await sleep(200);
log.push(["typed t (panel stays)", tabInfo(), gURLBar.value]);
return log;
