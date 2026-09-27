const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

test("shared Settings wrappers preserve panel, compact row, and Hotkeys note markup", async () => {
  const { SettingsPanel, SettingsPanelRow, SectionHeader } =
    await import("../../src/components/ui/SettingsSection.tsx");
  const { SettingsLayoutProvider } = await import("../../src/components/ui/useSettingsLayout.ts");
  const render = (isCompact) =>
    renderToStaticMarkup(
      React.createElement(
        SettingsLayoutProvider,
        { value: { isCompact } },
        React.createElement(
          SettingsPanel,
          { className: "mb-2" },
          React.createElement(
            SettingsPanelRow,
            null,
            React.createElement(SectionHeader, {
              title: "Hotkeys",
              description: "Shortcuts",
              note: "Hyprland hint",
            })
          )
        )
      )
    );

  const regular = render(false);
  assert.match(regular, /rounded-lg border border-border\/70 dark:border-border-subtle\/70/);
  assert.match(regular, /divide-y divide-border\/60 dark:divide-border-subtle\/50 mb-2/);
  assert.match(regular, /class="px-4 py-3 "/);
  assert.match(regular, /<h3[^>]*>Hotkeys<\/h3>/);
  assert.match(regular, /Shortcuts<\/p><p[^>]*>Hyprland hint<\/p>/);
  assert.match(render(true), /class="px-3 py-2\.5 "/);
});
