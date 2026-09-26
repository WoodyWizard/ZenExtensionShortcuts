// Helpers prepended to test scripts run through tools/marionette.mjs (evalfile).
// They produce trusted input events, so focus changes and default actions happen
// exactly like with a real mouse and keyboard.

const sleep = ms => new Promise(r => setTimeout(r, ms));
const $ = sel => document.querySelector(sel);

function center(el) {
  const r = el.getBoundingClientRect();
  return [r.left + r.width / 2, r.top + r.height / 2];
}

function mouse(type, x, y, button = 0) {
  const pressed = type == "mousedown" || (type == "mousemove" && mouse.down);
  if (type == "mousedown") mouse.down = true;
  if (type == "mouseup") mouse.down = false;
  window.synthesizeMouseEvent(type, x, y, {
    button,
    buttons: pressed ? 1 << (button == 1 ? 2 : button == 2 ? 1 : 0) : 0,
    clickCount: type == "mousemove" ? 0 : 1,
  });
}

async function click(el, button = 0) {
  const [x, y] = center(el);
  mouse("mousemove", x, y);
  mouse("mousedown", x, y, button);
  mouse("mouseup", x, y, button);
  await sleep(120);
}

async function dragTo(el, target, steps = 8) {
  const [x0, y0] = center(el);
  const [x1, y1] = center(target);
  mouse("mousemove", x0, y0);
  mouse("mousedown", x0, y0);
  for (let i = 1; i <= steps; i++) {
    mouse("mousemove", x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps);
    await sleep(30);
  }
  mouse("mouseup", x1, y1);
  await sleep(300);
}

const tip = Cc["@mozilla.org/text-input-processor;1"].createInstance(Ci.nsITextInputProcessor);
tip.beginInputTransactionForTests(window);

function key(keyName, { code, keyCode, alt = false } = {}) {
  const init = { key: keyName, code: code ?? keyName, keyCode: keyCode ?? 0 };
  if (alt) {
    tip.keydown(new KeyboardEvent("", { key: "Alt", code: "AltLeft", keyCode: 18 }));
  }
  tip.keydown(new KeyboardEvent("", init));
  tip.keyup(new KeyboardEvent("", init));
  if (alt) {
    tip.keyup(new KeyboardEvent("", { key: "Alt", code: "AltLeft", keyCode: 18 }));
  }
}

function type(text) {
  for (const ch of text) {
    tip.keydown(new KeyboardEvent("", { key: ch }));
    tip.keyup(new KeyboardEvent("", { key: ch }));
  }
}

function state() {
  const p = gZenFavoritesPanel;
  return {
    shown: p.isShown,
    editing: p.editing,
    formTarget: p.formTarget,
    active: document.activeElement?.className || document.activeElement?.id || document.activeElement?.localName,
    error: p.error.textContent,
    items: p.items.map(i => i.title),
  };
}

async function openNewTab() {
  if (!gURLBar.hasAttribute("zen-newtab")) {
    BrowserCommands.openTab();
  }
  await sleep(900);
}
