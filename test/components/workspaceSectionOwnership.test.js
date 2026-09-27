const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHostDom,
} = require("../lib/rendererTestHarness");

test("workspace switch remounts developer-owned secret without remounting create flow", async (t) => {
  let root = null;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
    delete globalThis.__workspaceStore;
    delete globalThis.__developerSecret;
    delete globalThis.__setDeveloperSecret;
    delete globalThis.__createMounts;
  });
  installBrowserGlobals(t);
  const container = installHostDom(t);
  globalThis.__createMounts = 0;
  const vite = await createRendererServer(t, {
    cachePrefix: "openwhispr-workspace-section-test-",
    noExternal: ["react-i18next"],
    mockModules: {
      "react-i18next": `export const useTranslation = () => ({ t: (key) => key });`,
      "/components/icons": `export const Users = () => null; export const UserPlus = () => null; export const Trash2 = () => null; export const LogOut = () => null; export const ChevronDown = () => null; export const Loader2 = () => null;`,
      "/stores/workspaceStore": `
        import { create } from "zustand";
        export const useWorkspaceStore = create((set) => ({
          workspaces: [{ id: "one", name: "One", role: "owner" }, { id: "two", name: "Two", role: "owner" }],
          activeWorkspaceId: "one", loaded: true, loading: false, error: false,
          setActiveWorkspaceId: (id) => set({ activeWorkspaceId: id }), refresh: async () => {},
        }));
        globalThis.__workspaceStore = useWorkspaceStore;
      `,
      "/hooks/useAuth": `export const useAuth = () => ({ isSignedIn: true });`,
      "/hooks/useDialogs": `export const useDialogs = () => ({ confirmDialog: { open: false } });`,
      "/hooks/useLocalStorage": `import { useState } from "react"; export const useLocalStorage = () => useState("developer");`,
      "/services/WorkspacesService": `export const WorkspacesService = {};`,
      "/ui/button": `import React from "react"; export const Button = ({ children, ...props }) => React.createElement("button", props, children);`,
      "/ui/input": `export const Input = () => null;`,
      "/ui/SettingsSection": `export const SettingsPanel = () => null; export const SettingsPanelRow = () => null; export const SettingsRow = () => null;`,
      "/ui/useToast": `export const useToast = () => ({ toast() {} });`,
      "/ui/dialog": `export const ConfirmDialog = () => null;`,
      "/CreateWorkspaceDialog": `
        import { useEffect } from "react";
        export default function CreateWorkspaceDialog() {
          useEffect(() => { globalThis.__createMounts++; }, []);
          return null;
        }
      `,
      "/InviteTeammateDialog": `export default function InviteTeammateDialog() { return null; }`,
      "/ui/dropdown-menu": `
        import React from "react";
        const W = ({ children }) => React.createElement("div", null, children);
        export const DropdownMenu = W; export const DropdownMenuTrigger = W;
        export const DropdownMenuContent = W; export const DropdownMenuItem = W;
        export const DropdownMenuLabel = W; export const DropdownMenuSeparator = W;
      `,
      "/lib/utils": `export const cn = (...names) => names.filter(Boolean).join(" ");`,
      "/lib/spacePermissions": `export const canManageWorkspace = (role) => role !== "member";`,
      "/WorkspaceMembersTab": `export default function WorkspaceMembersTab() { return null; }`,
      "/WorkspaceTeamsTab": `export default function WorkspaceTeamsTab() { return null; }`,
      "/WorkspaceDeveloperTab": `
        import React, { useState } from "react";
        export default function WorkspaceDeveloperTab({ workspace }) {
          const [secret, setSecret] = useState("");
          globalThis.__developerSecret = secret;
          globalThis.__setDeveloperSecret = setSecret;
          return React.createElement("div", null, workspace.id, secret);
        }
      `,
      "/EnterpriseConsoleRow": `export default function EnterpriseConsoleRow() { return null; }`,
    },
  });
  const { default: WorkspaceSection } = await vite.ssrLoadModule(
    "/components/settings/WorkspaceSection.tsx"
  );
  root = createRoot(container);
  await React.act(async () => root.render(React.createElement(WorkspaceSection)));
  await React.act(async () => globalThis.__setDeveloperSecret("one-time-key"));
  assert.equal(globalThis.__developerSecret, "one-time-key");
  await React.act(async () => globalThis.__workspaceStore.getState().setActiveWorkspaceId("two"));
  assert.equal(globalThis.__developerSecret, "");
  assert.equal(globalThis.__createMounts, 1);
  assert.equal(container.textContent.includes("one-time-key"), false);
  await React.act(async () => globalThis.__setDeveloperSecret("second-key"));
  await React.act(async () =>
    globalThis.__workspaceStore.setState((state) => ({
      workspaces: state.workspaces.map((w) => (w.id === "two" ? { ...w, role: "member" } : w)),
    }))
  );
  assert.equal(container.textContent.includes("second-key"), false);
  await React.act(async () =>
    globalThis.__workspaceStore.setState((state) => ({
      workspaces: state.workspaces.map((w) => (w.id === "two" ? { ...w, role: "owner" } : w)),
    }))
  );
  assert.equal(globalThis.__developerSecret, "");
  assert.equal(globalThis.__createMounts, 1);
});
