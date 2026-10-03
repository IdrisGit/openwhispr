const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRendererServer } = require("../lib/rendererTestHarness");
const { mountAuditDom } = require("../lib/settingsAuditHarness");
const en = require("../../src/locales/en/translation.json");
const fr = require("../../src/locales/fr/translation.json");
const tr = (dict, key, params = {}) =>
  String(key.split(".").reduce((s, k) => s?.[k], dict) ?? key).replace(
    /\{\{(\w+)\}\}/g,
    (_, key) => params[key] ?? ""
  );

test("real searchable model leaf announces its Arrow/Enter target and keeps native selected buttons", async (t) => {
  const { dom, container, render } = await mountAuditDom(t);
  const vite = await createRendererServer(t, {
    noExternal: ["react-i18next", "@tanstack/react-virtual"],
    mockModules: {
      "react-i18next": `const t=key=>key;export const useTranslation=()=>({t});`,
      "@tanstack/react-virtual": `let count=0;const instance={scrollToOffset(){},scrollToIndex(){},measureElement(){},getTotalSize:()=>count*40,getVirtualItems:()=>Array.from({length:count},(_,index)=>({index,start:index*40}))};export const useVirtualizer=options=>{count=options.count;return instance;};`,
    },
  });
  const { default: List } = await vite.ssrLoadModule("/components/ui/SearchableModelList.tsx");
  const models = [
    { value: "vendor/one", label: "One" },
    { value: "vendor/two", label: "Two" },
  ];
  const selected = [];
  function Owner() {
    const [model, setModel] = React.useState("");
    return React.createElement(List, {
      models,
      selectedModel: model,
      onModelSelect: (id) => {
        selected.push(id);
        setModel(id);
      },
    });
  }
  await render(React.createElement(Owner));
  const input = container.querySelector('input[type="search"]');
  await React.act(async () => input.focus());
  await React.act(async () =>
    input.dispatchEvent(new dom.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }))
  );
  const status = container.querySelector('[role="status"]');
  assert.equal(status.textContent, "one");
  assert.equal(input.getAttribute("aria-describedby"), status.id);
  await React.act(async () =>
    input.dispatchEvent(new dom.KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
  );
  assert.deepEqual(selected, ["vendor/one"]);
  assert.ok(container.querySelector('button[aria-pressed="true"]'), container.innerHTML);
  assert.equal(container.querySelector('[role="option"] button'), null);
  for (const button of container.querySelectorAll("button[aria-pressed]")) {
    assert.equal(button.tabIndex, 0);
    await React.act(async () => button.focus());
    assert.equal(dom.document.activeElement, button);
  }
});

test("real Translation target buttons have distinct localized language names and focus indicators", async (t) => {
  const { container, render } = await mountAuditDom(t);
  globalThis.__targetNames = { t: (key, params) => tr(en, key, params) };
  t.after(() => delete globalThis.__targetNames);
  const vite = await createRendererServer(t, {
    noExternal: ["react-i18next"],
    mockModules: {
      "react-i18next": `export const useTranslation=()=>({t:globalThis.__targetNames.t});`,
      "/stores/settingsStore": `import {create} from "zustand";export const MAX_TRANSLATION_TARGETS=3;export const useSettingsStore=create(set=>({useDictationTranslation:true,translationSourceLanguage:"auto",translationTargets:["en-US","es"],translationTargetLanguage:"en-US",setUseDictationTranslation:value=>set({useDictationTranslation:value}),setTranslationSourceLanguage:value=>set({translationSourceLanguage:value}),setTranslationTargetLanguage:value=>set({translationTargetLanguage:value}),setTranslationTargets:value=>set({translationTargets:value})}));`,
      "/ui/LanguageSelector": `export default ()=>null;`,
      "/InferenceConfigEditor": `export default ()=>null;`,
      "/ui/PromptStudio": `export default ()=>null;`,
    },
  });
  const { default: Targets } = await vite.ssrLoadModule(
    "/components/settings/DictationTranslationSettings.tsx"
  );
  await render(React.createElement(Targets));
  const buttons = () => [...container.querySelectorAll("button[aria-pressed]")];
  assert.equal(buttons().length, 2);
  assert.notEqual(buttons()[0].getAttribute("aria-label"), buttons()[1].getAttribute("aria-label"));
  assert.match(buttons()[0].getAttribute("aria-label"), /English/);
  assert.match(buttons()[1].getAttribute("aria-label"), /Spanish/);
  assert.ok(buttons().every((button) => button.className.includes("focus-visible:ring")));
  await React.act(async () => buttons()[1].click());
  assert.equal(buttons()[1].getAttribute("aria-pressed"), "true");
  globalThis.__targetNames.t = (key, params) => tr(fr, key, params);
  await render(React.createElement(Targets));
  assert.match(buttons()[1].getAttribute("aria-label"), /Choisir Spanish/);
  const removes = [...container.querySelectorAll("button")].filter((button) =>
    button.getAttribute("aria-label")?.includes("Supprimer")
  );
  assert.equal(removes.length, 2);
  assert.notEqual(removes[0].getAttribute("aria-label"), removes[1].getAttribute("aria-label"));
});
