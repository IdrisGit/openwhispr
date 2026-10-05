const React = require("react");
const { createRoot } = require("react-dom/client");

async function mountAuditDom(t) {
  const { Window } = await import("happy-dom");
  const dom = new Window();
  dom.electronAPI = {};
  const names = [
    "window",
    "document",
    "DocumentFragment",
    "localStorage",
    "navigator",
    "HTMLElement",
    "HTMLInputElement",
    "HTMLTextAreaElement",
    "HTMLButtonElement",
    "HTMLSelectElement",
    "Element",
    "Node",
    "NodeFilter",
    "CustomEvent",
    "Event",
    "MutationObserver",
    "ResizeObserver",
    "getComputedStyle",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "IS_REACT_ACT_ENVIRONMENT",
  ];
  const before = new Map(
    names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)])
  );
  for (const name of names) {
    const value =
      name === "window"
        ? dom
        : name === "IS_REACT_ACT_ENVIRONMENT"
          ? true
          : ["getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"].includes(name)
            ? dom[name].bind(dom)
            : dom[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  const container = dom.document.createElement("div");
  dom.document.body.appendChild(container);
  const root = createRoot(container);
  t.after(async () => {
    globalThis.window = dom;
    globalThis.document = dom.document;
    await React.act(async () => root.unmount());
    // Radix dispatches its unmount autofocus event from a zero-delay timer.
    await React.act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
    await dom.happyDOM.close();
    for (const [name, descriptor] of before) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  return { dom, container, root, render: (node) => React.act(async () => root.render(node)) };
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

module.exports = { mountAuditDom, deferred };
