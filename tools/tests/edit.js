const log = [];
await openNewTab();
log.push(["opened", state()]);

await click($("#zfav-panel .zfav-edit-toggle"));
log.push(["edit on", state()]);

await click($("#zfav-panel .zfav-add"));
log.push(["add form", state()]);

// Save with empty URL -> validation error, bar must stay open
await click(gZenFavoritesPanel.saveButton);
log.push(["empty save", state()]);

type("news.ycombinator.com");
await sleep(50);
log.push(["typed", state(), gZenFavoritesPanel.urlInput.value]);

// Move focus to the name field by clicking it
await click(gZenFavoritesPanel.nameInput);
type("HN");
key("Enter", { keyCode: 13 });
await sleep(400);
log.push(["saved", state()]);

// Edit an existing one: click tile "reddit.com", rename, Enter
const reddit = [...document.querySelectorAll("#zfav-panel .zfav-tile[data-guid]")].find(t => t.textContent.includes("reddit"));
await click(reddit);
log.push(["edit form", state(), gZenFavoritesPanel.nameInput.value, gZenFavoritesPanel.urlInput.value]);
gZenFavoritesPanel.nameInput.select();
type("Reddit");
key("Enter", { keyCode: 13 });
await sleep(400);
log.push(["renamed", state()]);

// Escape in form closes the form but keeps the bar
await click($("#zfav-panel .zfav-add"));
key("Escape", { keyCode: 27 });
await sleep(150);
log.push(["escape", state()]);

return log;
