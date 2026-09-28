const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

test("shared Settings header includes the Hotkeys description and optional note", async () => {
  const { SectionHeader } = await import("../../src/components/ui/SettingsSection.tsx");
  const markup = renderToStaticMarkup(
    React.createElement(SectionHeader, {
      title: "Hotkeys",
      description: "Shortcuts",
      note: "Hyprland hint",
    })
  );

  assert.match(markup, /<h3[^>]*>Hotkeys<\/h3>/);
  assert.match(markup, /<p[^>]*>Shortcuts<\/p>/);
  assert.match(markup, /<p[^>]*>Hyprland hint<\/p>/);
});
