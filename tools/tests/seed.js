const { ZenFavoritesStore: S } = ChromeUtils.importESModule(
  "chrome://userchrome/content/zen-newtab-favorites/store.sys.mjs"
);
for (const f of await S.list()) await S.remove(f.guid);
const sites = [
  ["GitHub", "github.com"],
  ["YouTube", "youtube.com"],
  ["Wikipedia", "ru.wikipedia.org"],
  ["Gmail", "mail.google.com"],
  ["Habr", "habr.com"],
  ["Переводчик", "translate.google.com"],
  ["", "reddit.com"],
];
for (const [title, url] of sites) await S.add({ title, url: S.normalizeUrl(url) });
await new Promise(r => setTimeout(r, 300));
return (await S.list()).map(f => f.title + " " + f.url);
