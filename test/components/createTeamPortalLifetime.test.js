const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRendererServer } = require("../lib/rendererTestHarness");
const { mountAuditDom, deferred } = require("../lib/settingsAuditHarness");

for (const strict of [false, true]) {
  test(`real create-team Portal settles its roster on first open/reopen${strict ? " in StrictMode" : ""}`, async (t) => {
    const { dom, render } = await mountAuditDom(t);
    const reads = [];
    globalThis.__portalRoster = {
      begin: () => {
        const request = deferred();
        reads.push(request);
        return request.promise;
      },
    };
    t.after(() => delete globalThis.__portalRoster);
    const vite = await createRendererServer(t, {
      noExternal: ["react-i18next"],
      mockModules: {
        "react-i18next": `const t=key=>key;export const useTranslation=()=>({t});`,
        "/hooks/useAuth": `export const useAuth=()=>({user:{id:"fake-self"}});`,
        "/ui/useToast": `export const useToast=()=>({toast(){}});`,
        "/stores/workspaceStore": `import {create} from "zustand";export const EMPTY_WORKSPACE_MEMBERS=[];let sequence=0;export const useWorkspaceStore=create(set=>({membersByWorkspace:{},refreshMembers:async(id)=>{const current=++sequence;const members=await globalThis.__portalRoster.begin();if(current===sequence)set({membersByWorkspace:{[id]:members}});}}));`,
        "/services/TeamsService": `export const TeamsService={create:()=>{throw new Error("no creation allowed in roster test");}};`,
        "/services/spaceActions": `export const addTeamMembers=()=>{throw new Error("no member mutation allowed");};`,
        "/MemberPickList": `import React from "react";export default ({members})=>React.createElement("div",{"data-candidates":true},members.map(member=>member.name).join(" "));`,
      },
    });
    const { default: CreateTeam } = await vite.ssrLoadModule("/components/CreateTeamDialog.tsx");
    let setOpen;
    function Owner() {
      const [open, update] = React.useState(true);
      setOpen = update;
      return React.createElement(CreateTeam, { workspaceId: "A", open, onOpenChange: update });
    }
    await render(
      React.createElement(
        strict ? React.StrictMode : React.Fragment,
        null,
        React.createElement(Owner)
      )
    );
    assert.ok(reads.length > 0, "committed Portal starts a roster read");
    await React.act(async () => {
      for (const request of reads)
        request.resolve([{ user_id: "other", name: "Candidate", email: "candidate@example.test" }]);
    });
    assert.match(dom.document.querySelector("[data-candidates]").textContent, /Candidate/);
    const previousReads = reads.length;
    await React.act(async () => setOpen(false));
    await React.act(async () => setOpen(true));
    assert.ok(reads.length > previousReads);
    await React.act(async () => {
      for (const request of reads.slice(previousReads))
        request.reject(new Error("fake roster failure"));
    });
    const retry = [...dom.document.querySelectorAll("button")].find((button) =>
      button.textContent.includes("loadError.retry")
    );
    assert.ok(retry, "rejected real-Portal read settles to Retry rather than an endless skeleton");
    await React.act(async () => retry.click());
    await React.act(async () =>
      reads
        .at(-1)
        .resolve([{ user_id: "recovery", name: "Recovered", email: "recovery@example.test" }])
    );
    assert.match(dom.document.querySelector("[data-candidates]").textContent, /Recovered/);
  });
}
