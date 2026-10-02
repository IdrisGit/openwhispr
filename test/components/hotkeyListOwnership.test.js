const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHostDom,
} = require("../lib/rendererTestHarness");

test("hotkey registration rejection rolls back the optimistic row without losing external changes", async (t) => {
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
    delete globalThis.__hotkeyRows;
  });
  installBrowserGlobals(t);
  const container = installHostDom(t);
  const vite = await createRendererServer(t, {
    cachePrefix: "openwhispr-hotkey-list-owner-",
    noExternal: ["react-i18next"],
    mockModules: {
      "react-i18next": `const t = (key) => key; export function useTranslation() { return { t }; }`,
      "./HotkeyInput": `export function HotkeyInput(props) {
        globalThis.__hotkeyRows.push(props);
        return null;
      }`,
      "../icons": `export const Plus = () => null;`,
    },
  });
  const { HotkeyListInput } = await vite.ssrLoadModule("/components/ui/HotkeyListInput.tsx");
  globalThis.__hotkeyRows = [];
  let reject;
  let value = "F8";
  const onChange = () => new Promise((_, fail) => (reject = fail));
  const render = async () => {
    globalThis.__hotkeyRows.length = 0;
    await React.act(async () =>
      root.render(React.createElement(HotkeyListInput, { value, onChange, onClear: onChange }))
    );
  };
  root = createRoot(container);
  const row = () => globalThis.__hotkeyRows.at(-1);
  await render();
  assert.equal(row().value, "F8");
  await React.act(async () => row().onChange("F9"));
  assert.equal(row().value, "F9");
  await React.act(async () => reject(Error("IPC rejected")));
  assert.equal(row().value, "F8");

  await React.act(async () => row().onClear());
  assert.equal(row().value, "");
  await React.act(async () => reject(Error("IPC rejected")));
  assert.equal(row().value, "F8");

  await React.act(async () => row().onChange("F9"));
  value = "F10";
  await render();
  await React.act(async () => reject(Error("late rejection")));
  assert.equal(row().value, "F10");
});
