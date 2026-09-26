// Minimal Marionette client for driving a dev Zen instance started with --marionette.
//
// Usage:
//   node tools/marionette.mjs eval "<chrome js>"       run JS in the browser window (use `return`)
//   node tools/marionette.mjs evalfile <file.js>        same, script from a file
//   node tools/marionette.mjs shot <out.png>            screenshot of the browser window
//
// Scripts run in chrome context, so `window`, `gURLBar`, `gBrowser` etc. are available.
// A script may return a Promise; it is awaited.

import net from "node:net";
import fs from "node:fs";

const PORT = Number(process.env.MARIONETTE_PORT || 2828);

class Marionette {
  #sock;
  #buf = Buffer.alloc(0);
  #id = 0;
  #pending = new Map();
  #hello;

  connect() {
    return new Promise((resolve, reject) => {
      this.#hello = resolve;
      this.#sock = net.connect(PORT, "127.0.0.1");
      this.#sock.on("error", reject);
      this.#sock.on("data", chunk => this.#onData(chunk));
    });
  }

  #onData(chunk) {
    this.#buf = Buffer.concat([this.#buf, chunk]);
    for (;;) {
      const colon = this.#buf.indexOf(":");
      if (colon < 0) return;
      const len = Number(this.#buf.subarray(0, colon).toString());
      if (this.#buf.length < colon + 1 + len) return;
      const msg = JSON.parse(this.#buf.subarray(colon + 1, colon + 1 + len).toString());
      this.#buf = this.#buf.subarray(colon + 1 + len);
      if (this.#hello) {
        const h = this.#hello;
        this.#hello = null;
        h(msg);
        continue;
      }
      const [, id, error, result] = msg;
      const p = this.#pending.get(id);
      this.#pending.delete(id);
      if (error) p.reject(new Error(`${error.error}: ${error.message}`));
      else p.resolve(result);
    }
  }

  send(name, params = {}) {
    const id = ++this.#id;
    const body = Buffer.from(JSON.stringify([0, id, name, params]));
    this.#sock.write(`${body.length}:`);
    this.#sock.write(body);
    return new Promise((resolve, reject) => this.#pending.set(id, { resolve, reject }));
  }

  close() {
    this.#sock.end();
  }
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  const m = new Marionette();
  await m.connect();
  await m.send("WebDriver:NewSession", { capabilities: {} });
  await m.send("Marionette:SetContext", { value: "chrome" });
  // Make sure we talk to the main browser window, not a leftover dialog.
  const handles = await m.send("WebDriver:GetWindowHandles");
  for (const h of handles.value ?? handles) {
    await m.send("WebDriver:SwitchToWindow", { handle: h });
    const r = await m.send("WebDriver:ExecuteScript", {
      script: "return document.documentElement.getAttribute('windowtype')",
    });
    if (r.value === "navigator:browser") break;
  }

  try {
    if (cmd === "eval" || cmd === "evalfile") {
      const src = cmd === "eval" ? arg : fs.readFileSync(arg, "utf8");
      const script = `
        const [resolve] = [arguments[arguments.length - 1]];
        (async () => { ${src} })().then(
          v => resolve({ ok: true, v }),
          e => resolve({ ok: false, e: String(e) + "\\n" + (e && e.stack || "") })
        );`;
      const r = await m.send("WebDriver:ExecuteAsyncScript", {
        script,
        args: [],
        scriptTimeout: 30000,
      });
      const out = r.value;
      if (!out.ok) {
        console.error(out.e);
        process.exitCode = 1;
      } else if (out.v !== undefined) {
        console.log(typeof out.v === "string" ? out.v : JSON.stringify(out.v, null, 2));
      }
    } else if (cmd === "shot") {
      const r = await m.send("WebDriver:TakeScreenshot", { full: false, hash: false });
      fs.writeFileSync(arg, Buffer.from(r.value, "base64"));
      console.log(`saved ${arg}`);
    } else {
      console.error("unknown command; use eval | evalfile | shot");
      process.exitCode = 2;
    }
  } finally {
    await m.send("WebDriver:DeleteSession").catch(() => {});
    m.close();
  }
}

main().catch(e => {
  console.error(e.message);
  process.exit(1);
});
