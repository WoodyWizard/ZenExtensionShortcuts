const log = [];
key("Escape", { keyCode: 27 });
key("Escape", { keyCode: 27 });
await sleep(400);
log.push(["closed", gURLBar.hasAttribute("breakout-extend"), gURLBar.hasAttribute("zen-newtab")]);

// Ctrl+L on a page: URL bar opens without zen-newtab -> no panel
document.getElementById("Browser:OpenLocation").doCommand();
await sleep(600);
log.push(["ctrl+L", {
  floating: gURLBar.getAttribute("zen-floating-urlbar"),
  newtab: gURLBar.hasAttribute("zen-newtab"),
  panel: getComputedStyle($("#zfav-panel")).display,
}]);
key("Escape", { keyCode: 27 });
key("Escape", { keyCode: 27 });
await sleep(400);

// Light theme preview (stays on for the screenshot for 5 s, then goes back to the system theme)
Services.prefs.setIntPref("ui.systemUsesDarkTheme", 0);
setTimeout(() => Services.prefs.clearUserPref("ui.systemUsesDarkTheme"), 5000);
await sleep(300);
await openNewTab();
log.push(["light", matchMedia("(prefers-color-scheme: dark)").matches]);
return log;
