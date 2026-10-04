const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRendererServer } = require("../lib/rendererTestHarness");
const { mountAuditDom, deferred } = require("../lib/settingsAuditHarness");

for (const kind of ["team", "space"]) {
  test(`${kind} roster accepts only owned latest reads and preserves independent row mutations`, async (t) => {
    const { render } = await mountAuditDom(t);
    const seen = (globalThis.__rosterOwner = {
      reads: [],
      writes: [],
      publications: [],
      toasts: [],
    });
    seen.load = (id) => {
      const read = { ...deferred(), id };
      seen.reads.push(read);
      return read.promise;
    };
    seen.mutate = (id) => {
      const write = { ...deferred(), id };
      seen.writes.push(write);
      return write.promise;
    };
    t.after(() => delete globalThis.__rosterOwner);
    const vite = await createRendererServer(t, {
      noExternal: ["react-i18next"],
      mockModules: {
        "react-i18next": `const t=key=>key;export const useTranslation=()=>({t,i18n:{language:"en"}});`,
        "/ui/useToast": `export const useToast=()=>({toast:p=>globalThis.__rosterOwner.toasts.push(p)});`,
        "/hooks/useAuth": `export const useAuth=()=>({user:{id:"self"}});`,
        "/hooks/useDialogs": `export const useDialogs=()=>({confirmDialog:{},showConfirmDialog(){},hideConfirmDialog(){}});`,
        "/ui/dialog": `export const ConfirmDialog=()=>null;`,
        "/InviteTeammateDialog": `export default ()=>null;`,
        "/SpaceGroupsSection": `export default ()=>null;`,
        "/MemberRoster": `import React from "react";export default props=>{globalThis.__rosterOwner.props=props;return React.createElement("output",null,JSON.stringify({members:props.members,loading:props.loading,error:props.loadFailed,busy:[...props.busyIds]}));};`,
        "/services/TeamsService": `export const TeamsService={listMembers:id=>globalThis.__rosterOwner.load(id)};`,
        "/services/SpacesService": `export const SpacesService={listMembers:id=>globalThis.__rosterOwner.load(id)};`,
        "/services/spaceActions": `
          import {invalidateSpaceRoster} from "/lib/spaceRosterCache.ts";
          import {getAuthRequestContextSnapshot} from "/lib/authRequestContext.ts";
          const mutate=async(id)=>{const account=getAuthRequestContextSnapshot();
            const result=await globalThis.__rosterOwner.mutate(id);
            if(account===getAuthRequestContextSnapshot())invalidateSpaceRoster();
            return result;
          };
          export const setTeamMemberRole=mutate,setSpaceMemberRole=space=>mutate(space.cloud_space_id),removeTeamMember=mutate,removeSpaceMember=mutate;
          export const addTeamMembers=async(id)=>{await mutate(id);return {failures:[]}};
          export const addSpaceMembers=async(space)=>{await mutate(space.cloud_space_id);return {failures:[]}};`,
        "/stores/workspaceStore": `const state={workspaces:[{id:"ws",role:"owner"}],membersByWorkspace:{},refreshMembers:async()=>{}};export const EMPTY_WORKSPACE_MEMBERS=[];export const useWorkspaceStore=fn=>fn(state);`,
      },
    });
    const { default: Component } = await vite.ssrLoadModule(
      kind === "team"
        ? "/components/TeamRosterSection.tsx"
        : "/components/notes/SpaceMembersPanel.tsx"
    );
    const auth = await vite.ssrLoadModule("/lib/authRequestContext.ts");
    const publish = (members) => seen.publications.push(members);
    const node = (id, onRosterChange = publish) =>
      React.createElement(
        React.StrictMode,
        null,
        React.createElement(
          Component,
          kind === "team"
            ? {
                teamId: id,
                teamName: id,
                canManage: true,
                workspaceMembers: [],
                onRosterChange,
                removeConfirm() {},
              }
            : {
                space: {
                  id: 1,
                  name: id,
                  cloud_space_id: id,
                  workspace_id: "ws",
                  teams: [],
                  role: "admin",
                },
              }
        )
      );
    const member = (name) => ({
      user_id: name,
      email: `${name}@example.test`,
      name,
      role: "member",
      via_teams: [],
    });
    const finish = (read, name) => React.act(async () => read.resolve([member(name)]));
    await render(node("A"));
    assert.equal(seen.reads.length, 2, "StrictMode read cleanup rejects the probe");
    await finish(seen.reads[1], "fresh");
    await React.act(async () => seen.reads[0].reject(new Error("obsolete")));
    assert.equal(seen.props.members[0].name, "fresh");
    assert.equal(seen.props.loadFailed, false);
    const retry = seen.props.onRetry;
    await React.act(async () => {
      retry();
      retry();
    });
    await finish(seen.reads[3], "newest");
    await finish(seen.reads[2], "older");
    assert.equal(seen.props.members[0].name, "newest");
    if (kind === "team")
      assert.deepEqual(
        seen.publications.map((m) => m[0].name),
        ["fresh", "newest"]
      );

    await React.act(async () => {
      seen.props.onAdd(member("one"));
      seen.props.onAdd(member("two"));
    });
    assert.equal(seen.writes.length, 2, "different rows are not globally locked");
    assert.deepEqual([...seen.props.busyIds].sort(), ["one", "two"]);
    const readsBeforeWrites = seen.reads.length;
    await React.act(async () => seen.writes[0].resolve());
    assert.equal(
      seen.reads.length,
      readsBeforeWrites + 1,
      "service invalidation owns one post-write read"
    );
    const firstReload = seen.reads.at(-1);
    await React.act(async () => seen.writes[1].resolve());
    assert.equal(seen.reads.length, readsBeforeWrites + 2, "a second write adds only one read");
    const secondReload = seen.reads.at(-1);
    assert.notEqual(firstReload, secondReload, "every successful current write reloads");
    await finish(secondReload, "both-written");
    await finish(firstReload, "first-write-only");
    assert.equal(seen.props.members[0].name, "both-written");
    assert.equal(seen.props.busyIds.size, 0);

    if (kind === "team") {
      const replacements = [];
      await React.act(async () => seen.props.onAdd(member("callback-write")));
      const pendingWrite = seen.writes.at(-1),
        beforeReads = seen.reads.length;
      await render(node("A", (list) => replacements.push(list)));
      assert.equal(
        seen.reads.length,
        beforeReads,
        "callback replacement does not reload or drop row ownership"
      );
      assert.ok(seen.props.busyIds.has("callback-write"));
      await React.act(async () => pendingWrite.resolve());
      assert.equal(
        seen.reads.length,
        beforeReads + 1,
        "completed write must reload with unchanged resource"
      );
      await finish(seen.reads.at(-1), "callback-reloaded");
      assert.equal(replacements.at(-1)[0].name, "callback-reloaded");
      await render(node("A"));
    }
    await React.act(async () => {
      seen.props.onAdd(member("failure"));
      seen.props.onAdd(member("failure"));
    });
    const failedWrite = seen.writes.at(-1),
      writeCount = seen.writes.length;
    assert.ok(seen.props.busyIds.has("failure"));
    await React.act(async () => seen.props.onAdd(member("failure")));
    assert.equal(seen.writes.length, writeCount, "same row cannot dispatch a duplicate action");
    const failuresBefore = seen.toasts.length,
      readsBefore = seen.reads.length;
    await React.act(async () => failedWrite.reject(new Error("current mutation failed")));
    assert.equal(seen.toasts.length, failuresBefore + 1);
    assert.equal(seen.toasts.at(-1).description, "current mutation failed");
    assert.equal(seen.props.busyIds.size, 0);
    assert.equal(seen.reads.length, readsBefore);
    await React.act(async () => seen.props.onRetry());
    await React.act(async () => seen.reads.at(-1).reject(new Error("current read failed")));
    assert.equal(seen.props.loadFailed, true);
    assert.equal(seen.props.loading, false);
    await React.act(async () => seen.props.onRetry());
    await finish(seen.reads.at(-1), "recovered");
    assert.equal(seen.props.loadFailed, false);

    const oldRetry = seen.props.onRetry;
    await React.act(async () => seen.props.onAdd(member("pending")));
    const oldMutation = seen.writes.at(-1);
    await React.act(async () => seen.props.onRetry());
    const oldRead = seen.reads.at(-1);
    await render(node("B"));
    assert.equal(seen.props.members.length, 0);
    assert.equal(seen.props.busyIds.size, 0);
    const reads = seen.reads.length,
      publications = seen.publications.length,
      toasts = seen.toasts.length;
    await React.act(async () => {
      oldRetry();
      oldMutation.resolve();
      oldRead.reject(new Error("old owner"));
    });
    assert.equal(
      seen.reads.length,
      reads + 1,
      "service invalidation refreshes the live resource, not the expired loader"
    );
    assert.equal(seen.reads.at(-1).id, "B");
    assert.equal(seen.publications.length, publications);
    assert.equal(seen.toasts.length, toasts);
    assert.equal(seen.props.loading, true, "old finally cannot end B's load");
    await finish(seen.reads.at(-1), "B-result");
    await React.act(async () => seen.props.onRetry());
    const abaRead = seen.reads.at(-1);
    await render(node("A"));
    await render(node("B"));
    await finish(seen.reads.at(-1), "B-current");
    await finish(abaRead, "B-obsolete");
    assert.equal(
      seen.props.members[0].name,
      "B-current",
      "ABA loader replacement expires its first lease"
    );
    await React.act(async () => seen.props.onAdd(member("reopened-write")));
    const reopenedWrite = seen.writes.at(-1);
    await render(null);
    await render(node("B"));
    await finish(seen.reads.at(-1), "read-before-write");
    const reopenedCount = seen.reads.length,
      oldToasts = seen.toasts.length;
    await React.act(async () => reopenedWrite.resolve());
    assert.equal(
      seen.reads.length,
      reopenedCount + 1,
      "same-resource remount must reconcile a completed old write"
    );
    assert.equal(seen.toasts.length, oldToasts, "old local feedback stays expired");
    await finish(seen.reads.at(-1), "after-write");
    await React.act(async () => seen.props.onAdd(member("aba-write")));
    const abaWrite = seen.writes.at(-1);
    await render(node("A"));
    await render(node("B"));
    await finish(seen.reads.at(-1), "ABA-read-before-write");
    const abaCount = seen.reads.length;
    await React.act(async () => abaWrite.resolve());
    assert.equal(seen.reads.length, abaCount + 1);
    await finish(seen.reads.at(-1), "ABA-after-write");
    await React.act(async () => seen.props.onRetry());
    const oldAuthRead = seen.reads.at(-1);
    await React.act(async () => seen.props.onAdd(member("old-account-write")));
    const oldAccountWrite = seen.writes.at(-1);
    await React.act(async () => auth.observeAuthTokenStateEvent({ generation: 2, hasToken: true }));
    const newAuthRead = seen.reads.at(-1);
    await finish(newAuthRead, "new-account");
    const accountReads = seen.reads.length,
      accountToasts = seen.toasts.length;
    await React.act(async () => oldAccountWrite.resolve());
    assert.equal(seen.reads.length, accountReads, "old-account writes cannot notify new owners");
    assert.equal(seen.toasts.length, accountToasts);
    await finish(oldAuthRead, "old-account");
    assert.equal(seen.props.members[0].name, "new-account");
    await React.act(async () => seen.props.onRetry());
    const unmounted = seen.reads.at(-1),
      count = seen.publications.length;
    await render(null);
    await finish(unmounted, "unmounted");
    assert.equal(seen.publications.length, count);
  });
}

test("real membership action invalidation dispatches exactly one roster read", async (t) => {
  const { render } = await mountAuditDom(t);
  const vite = await createRendererServer(t, {
    noExternal: ["react-i18next"],
    mockModules: {
      "react-i18next": `export const useTranslation=()=>({t:key=>key});`,
      "/ui/useToast": `export const useToast=()=>({toast(){}});`,
    },
  });
  const { useMemberRoster } = await vite.ssrLoadModule("/hooks/useMemberRoster.ts");
  const { createSpaceActions } = await vite.ssrLoadModule("/services/spaceActionsCore.ts");
  const { invalidateSpaceRoster } = await vite.ssrLoadModule("/lib/spaceRosterCache.ts");
  let reads = 0,
    roster,
    members = [];
  const load = async () => {
    reads++;
    return members;
  };
  const actions = createSpaceActions({
    teams: {
      addMember: async (_team, id) => {
        members = [...members, { user_id: id }];
      },
    },
    spaces: { mySpaces: async () => [] },
    mirror: { upsertCloudSpaces: async () => {} },
    local: { loadSpaces: async () => {} },
    invalidateSpaceRoster,
  });
  function MountedRoster() {
    roster = useMemberRoster("team:A", load);
    return React.createElement("div", { ref: roster.bindRoster });
  }
  await render(React.createElement(MountedRoster));
  assert.equal(reads, 1);
  await React.act(async () => roster.mutate("new", () => actions.addTeamMembers("A", ["new"])));
  assert.equal(reads, 2, "one successful write has one refresh owner");
  assert.deepEqual(roster.members, [{ user_id: "new" }]);
});
