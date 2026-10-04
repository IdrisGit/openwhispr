const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRendererServer } = require("../lib/rendererTestHarness");
const { mountAuditDom, deferred } = require("../lib/settingsAuditHarness");

test("real invitation Portal preserves unknown pricing, explicit free fallback and current billed-seat warnings", async (t) => {
  const { dom, render } = await mountAuditDom(t);
  const seen = (globalThis.__invitePrice = { previews: [], members: [], sent: [], toasts: [] });
  seen.preview = (id) => {
    const read = { ...deferred(), id };
    seen.previews.push(read);
    return read.promise;
  };
  seen.memberList = (id) => {
    const read = { ...deferred(), id };
    seen.members.push(read);
    return read.promise;
  };
  t.after(() => delete globalThis.__invitePrice);
  const vite = await createRendererServer(t, {
    noExternal: ["react-i18next", "@radix-ui/react-dialog"],
    mockModules: {
      "react-i18next": `const t=(key,opts)=>key+(opts?JSON.stringify(opts):"");export const useTranslation=()=>({t});`,
      "/ui/useToast": `export const useToast=()=>({toast:p=>globalThis.__invitePrice.toasts.push(p)});`,
      "/services/WorkspacesService": `export const WorkspacesService={previewSeats:id=>globalThis.__invitePrice.preview(id),listMembers:id=>globalThis.__invitePrice.memberList(id)};`,
      "/services/InvitationsService": `export const InvitationsService={send:async(id,input)=>{globalThis.__invitePrice.sent.push({id,input});if(globalThis.__invitePrice.sendError)throw globalThis.__invitePrice.sendError;return {email_sent:true}}};`,
      "/stores/workspaceStore": `import {create} from "zustand";export const useWorkspaceStore=create(()=>({workspaces:[]}));globalThis.__invitePrice.store=useWorkspaceStore;`,
    },
  });
  const { default: Invite } = await vite.ssrLoadModule("/components/InviteTeammateDialog.tsx");
  const store = seen.store;
  const { CloudApiError } = await vite.ssrLoadModule("/services/cloudApi.ts");
  const auth = await vite.ssrLoadModule("/lib/authRequestContext.ts");
  const workspace = (id, paid) => ({
    id,
    name: id,
    role: "owner",
    seats: 2,
    seats_used: 2,
    plan: paid ? "business" : "free",
    status: "active",
    stripe_subscription_id: paid ? "sub-fake" : null,
    stripe_customer_id: null,
  });
  store.setState({ workspaces: [workspace("A", true), workspace("B", false)] });
  let changeId, changeOpen;
  function Owner() {
    const [id, setId] = React.useState("A"),
      [open, setOpen] = React.useState(true);
    changeId = setId;
    changeOpen = setOpen;
    return React.createElement(Invite, {
      workspaceId: id,
      workspaceName: id,
      open,
      onOpenChange: setOpen,
    });
  }
  await render(React.createElement(React.StrictMode, null, React.createElement(Owner)));
  const buttons = () => [...dom.document.querySelectorAll("button")];
  const button = (text) => buttons().find((b) => b.textContent === text);
  const input = () => dom.document.querySelector("#invite-email");
  const edit = async (text) =>
    React.act(async () => {
      const el = input();
      el[Object.keys(el).find((k) => k.startsWith("__reactProps$"))].onChange({
        target: { value: text },
      });
    });
  const submit = () =>
    React.act(async () =>
      dom.document
        .querySelector("form")
        .dispatchEvent(new dom.Event("submit", { bubbles: true, cancelable: true }))
    );
  const retry = () => React.act(async () => button("common.retry").click());
  const quote = {
    current_quantity: 2,
    next_quantity: 3,
    seats_used: 2,
    amount_due: 1200,
    currency: "usd",
  };
  await edit("person@example.test");
  assert.equal(button("workspaces.invite.submit").disabled, true);
  await submit();
  assert.equal(seen.sent.length, 0);
  for (const error of [
    new Error("fake network"),
    new CloudApiError("fake forbidden", 403),
    new CloudApiError("fake refusal", 400, "seat_limit"),
    new CloudApiError("fake unsubscribed", 400, "no_subscription"),
  ]) {
    await React.act(async () => seen.previews.at(-1).reject(error));
    assert.ok(
      dom.document.body.textContent.includes("workspaces.invite.pricingUnavailable"),
      `reads=${seen.previews.length}: ${dom.document.body.textContent}`
    );
    assert.equal(
      seen.members.length,
      0,
      "unknown or contradictory paid refusals never use member-count fallback"
    );
    await submit();
    assert.equal(seen.sent.length, 0);
    await retry();
  }
  await React.act(async () => seen.previews.at(-1).resolve(quote));
  assert.equal(button("workspaces.invite.submit").disabled, false);
  assert.ok(dom.document.body.textContent.includes("workspaces.invite.seatCost"));
  assert.ok(dom.document.body.textContent.includes("$12.00"));

  await React.act(async () =>
    store.setState({
      workspaces: [workspace("A", true), workspace("B", false)].map((w) =>
        w.id === "A" ? { ...w, seats: 3 } : w
      ),
    })
  );
  assert.equal(
    button("workspaces.invite.submit").disabled,
    true,
    "capacity changes invalidate accepted pricing"
  );
  const obsolete = seen.previews.at(-1);
  await React.act(async () => changeId("B"));
  const current = seen.previews.at(-1);
  await React.act(async () => obsolete.resolve(quote));
  assert.equal(button("workspaces.invite.submit").disabled, true);
  await React.act(async () =>
    current.reject(new CloudApiError("fake free", 400, "no_subscription"))
  );
  assert.equal(seen.members.length, 1);
  await React.act(async () => seen.members[0].resolve([{ user_id: "one" }]));
  assert.equal(
    button("workspaces.invite.submit").disabled,
    true,
    "new owner has empty email draft"
  );
  await edit("free@example.test");
  assert.equal(button("workspaces.invite.submit").disabled, false);
  assert.equal(dom.document.body.textContent.includes("workspaces.invite.seatCost"), false);
  await submit();
  assert.equal(seen.sent.at(-1).id, "B");

  await React.act(async () => changeOpen(true));
  await React.act(async () =>
    seen.previews.at(-1).reject(new CloudApiError("explicit free", 400, "no_subscription"))
  );
  await React.act(async () =>
    seen.members.at(-1).reject(new Error("optional occupancy unavailable"))
  );
  await edit("refused@example.test");
  assert.equal(
    button("workspaces.invite.submit").disabled,
    false,
    "known free pricing does not depend on optional occupancy read"
  );
  seen.sendError = new CloudApiError("server refuses invitation", 403, "forbidden");
  await submit();
  assert.ok(input(), "server refusal never closes as success");
  assert.equal(seen.toasts.at(-1).title, "workspaces.invite.errorTitle");
  delete seen.sendError;
  await React.act(async () => changeOpen(false));
  await React.act(async () => changeOpen(true));
  await React.act(async () =>
    seen.previews.at(-1).reject(new CloudApiError("explicit free", 400, "no_subscription"))
  );
  const staleFallback = seen.members.at(-1);
  await React.act(async () => changeId("A"));
  const staleA = seen.previews.at(-1);
  await React.act(async () => changeId("B"));
  const currentB = seen.previews.at(-1);
  await React.act(async () => {
    staleA.resolve(quote);
    staleFallback.resolve([{}, {}, {}, {}, {}]);
  });
  await edit("aba@example.test");
  assert.equal(
    button("workspaces.invite.submit").disabled,
    true,
    "ABA rejects old free fallback and paid replies"
  );
  await React.act(async () =>
    currentB.reject(new CloudApiError("explicit free", 400, "no_subscription"))
  );
  await React.act(async () => seen.members.at(-1).resolve([{}]));
  assert.equal(button("workspaces.invite.submit").disabled, false);
  assert.equal(dom.document.body.textContent.includes('"used":5'), false);
  await React.act(async () => {
    changeId("A");
    changeOpen(true);
  });
  const dismissed = seen.previews.at(-1);
  await React.act(async () => changeOpen(false));
  await React.act(async () => changeOpen(true));
  const reopened = seen.previews.at(-1);
  await React.act(async () => dismissed.resolve(quote));
  await edit("current@example.test");
  assert.equal(button("workspaces.invite.submit").disabled, true);
  await React.act(async () => reopened.resolve({ ...quote, current_quantity: 3, seats_used: 2 }));
  assert.equal(button("workspaces.invite.submit").disabled, false);
  assert.equal(dom.document.body.textContent.includes("workspaces.invite.seatCost"), false);
  await React.act(async () => auth.observeAuthTokenStateEvent({ generation: 8, hasToken: true }));
  assert.equal(button("workspaces.invite.submit").disabled, true);
  const detached = seen.previews.at(-1);
  await render(null);
  await React.act(async () => detached.reject(new Error("detached")));
  assert.equal(
    seen.toasts.length,
    2,
    "only the actual invitation and current server refusal notified"
  );
});
