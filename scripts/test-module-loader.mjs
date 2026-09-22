import vm from "node:vm";
import fs from "node:fs/promises";
const parseJson = (value, fallback = {}) => typeof value === "string" ? JSON.parse(value) : value ?? fallback;
const fail = async () => { throw new Error("Unexpected infrastructure operation"); };
export async function load(name, overrides = {}, env = {}, globals = {}) {
  const context = vm.createContext({ console, Buffer, URL, URLSearchParams, Request, Response, Headers, FormData, Blob, TextEncoder, TextDecoder, ReadableStream, AbortSignal, AbortController, Date, setTimeout, clearTimeout, setInterval, clearInterval, process: { env }, fetch: fail, ...globals });
  const modules = new Map();
  const stubs = { "db.js": { one: fail, rows: fail, transaction: fail, db: { query: fail }, parseJson }, "audit.js": { audit: async () => {} }, ...overrides };
  stubs["db.js"] = { one: fail, rows: fail, transaction: fail, db: { query: fail }, parseJson, ...overrides["db.js"] };
  function synthetic(values, identifier) { return new vm.SyntheticModule(Object.keys(values), function () { for (const [key,value] of Object.entries(values)) this.setExport(key,value); }, { context, identifier }); }
  async function moduleFor(identifier) {
    if (modules.has(identifier)) return modules.get(identifier);
    const base = identifier.split("/").at(-1);
    let module;
    if (stubs[identifier] || stubs[base]) module = synthetic(stubs[identifier] || stubs[base], identifier);
    else if (!identifier.startsWith("file:")) module = synthetic(await import(identifier), identifier);
    else module = new vm.SourceTextModule(await fs.readFile(new URL(identifier), "utf8"), { context, identifier });
    modules.set(identifier, module); return module;
  }
  const root = await moduleFor(new URL(`../src/lib/${name}`, import.meta.url).href);
  await root.link((specifier, referencing) => moduleFor(specifier.startsWith(".") ? new URL(specifier.endsWith(".js") ? specifier : `${specifier}.js`, referencing.identifier).href : specifier));
  await root.evaluate(); return root.namespace;
}
