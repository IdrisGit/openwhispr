import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "./icons";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { cn } from "./lib/utils";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useDelayedFlag } from "../hooks/useDelayedFlag";
import { InvitationsService } from "../services/InvitationsService";
import { WorkspacesService, type SeatPreview } from "../services/WorkspacesService";
import { formatAmount } from "../utils/formatAmount";
import { useToast } from "./ui/useToast";
import { useDialogSession } from "../hooks/useDialogSession";
import { CloudApiError } from "../services/cloudApi";
import { hasActiveWorkspaceSubscription, workspaceBillingSnapshot } from "../lib/workspaceBilling";

// This reader mounts inside the Portal, after the form's committed lease exists.
function InvitationPricingReader({ reload }: { reload: () => Promise<void> }) {
  useEffect(() => {
    void reload();
  }, [reload]);
  return null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  workspaceName: string;
  /** Receives the normalized email the invitation was sent to. */
  onInvited?: (email: string) => void;
  onReconciled?: (email: string) => void | Promise<void>;
  cancelLabel?: string;
  /** Teams the invitee joins on accept (threaded into the invitation). */
  teamIds?: string[];
  /** Spaces the invitee is added to directly on accept. */
  spaceIds?: string[];
  initialEmail?: string;
}

export default function InviteTeammateDialog({
  open,
  onOpenChange,
  workspaceId,
  workspaceName,
  onInvited,
  onReconciled,
  cancelLabel,
  teamIds,
  spaceIds,
  initialEmail,
}: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [submitting, setSubmitting] = useState(false);
  const showSpinner = useDelayedFlag(submitting);
  const { sessionKey, capture, invalidate, bindSession } = useDialogSession(
    open,
    JSON.stringify([workspaceId, teamIds, spaceIds])
  );
  const handleOpenChange = (next: boolean) => {
    if (!next) invalidate();
    onOpenChange(next);
  };
  const [pricing, setPricing] = useState<{
    owner: string;
    status: "loading" | "paid" | "free" | "error";
    preview: SeatPreview | null;
    used: number | null;
  } | null>(null);
  const pricingRequest = useRef(0);
  const workspace = useWorkspaceStore((s) => s.workspaces.find((w) => w.id === workspaceId));
  const billingSnapshot = workspace ? workspaceBillingSnapshot(workspace) : null;
  const pricingOwner = JSON.stringify([sessionKey, billingSnapshot]);
  const currentPricing = pricing?.owner === pricingOwner ? pricing : null;
  const seatPreview = currentPricing?.preview ?? null;
  const seatsUsed = currentPricing?.used ?? null;
  const seats = seatPreview?.current_quantity ?? workspace?.seats ?? null;
  const pricingReady = currentPricing?.status === "paid" || currentPricing?.status === "free";
  const knownSubscription =
    Boolean(workspace?.stripe_subscription_id) ||
    Boolean(workspace && hasActiveWorkspaceSubscription(workspace));
  const [previousPricingOwner, setPreviousPricingOwner] = useState(pricingOwner);
  if (previousPricingOwner !== pricingOwner) {
    setPreviousPricingOwner(pricingOwner);
    setPricing(null);
  }
  // A subscribed workspace already at capacity bills a seat if this invite is
  // accepted. Say so before sending. Both sides of the
  // comparison come from the same preview so a stale store can't misprice it.
  const addsBilledSeat =
    seatPreview !== null && seatPreview.seats_used >= seatPreview.current_quantity;

  const bindInvitation = useCallback(
    (node: HTMLElement | null) => {
      const cleanup = bindSession(node);
      if (!cleanup) return;
      return () => {
        cleanup();
        ++pricingRequest.current;
      };
    },
    [bindSession]
  );

  const reloadPricing = useCallback(async () => {
    const completion = capture();
    if (!completion.isCurrent()) return;
    const request = ++pricingRequest.current;
    const isCurrent = () => {
      const current = useWorkspaceStore.getState().workspaces.find((w) => w.id === workspaceId);
      return (
        completion.isCurrent() &&
        request === pricingRequest.current &&
        (current ? workspaceBillingSnapshot(current) : null) === billingSnapshot
      );
    };
    setPricing({ owner: pricingOwner, status: "loading", preview: null, used: null });
    try {
      const preview = await WorkspacesService.previewSeats(workspaceId, 1);
      if (isCurrent())
        setPricing({ owner: pricingOwner, status: "paid", preview, used: preview.seats_used });
    } catch (error) {
      if (!isCurrent()) return;
      // Only an explicit subscription refusal confirms there is no seat charge.
      // A known paid workspace contradicts it and must be refreshed/retried.
      if (
        !(error instanceof CloudApiError) ||
        error.code !== "no_subscription" ||
        knownSubscription
      ) {
        setPricing({ owner: pricingOwner, status: "error", preview: null, used: null });
        return;
      }
      setPricing({ owner: pricingOwner, status: "free", preview: null, used: null });
      try {
        const members = await WorkspacesService.listMembers(workspaceId);
        if (isCurrent())
          setPricing({ owner: pricingOwner, status: "free", preview: null, used: members.length });
      } catch {
        /* Occupancy is optional once no subscription is confirmed. */
      }
    }
  }, [capture, workspaceId, billingSnapshot, pricingOwner, knownSubscription]);

  const draftOwner = JSON.stringify([sessionKey, initialEmail]);
  const [previousOwner, setPreviousOwner] = useState("");
  if (previousOwner !== draftOwner) {
    setPreviousOwner(draftOwner);
    setEmail(open ? (initialEmail ?? "") : "");
    setRole("member");
    setSubmitting(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const currentWorkspace = useWorkspaceStore
      .getState()
      .workspaces.find((w) => w.id === workspaceId);
    if (
      !email.trim() ||
      submitting ||
      !pricingReady ||
      (currentWorkspace ? workspaceBillingSnapshot(currentWorkspace) : null) !== billingSnapshot
    )
      return;
    const completion = capture();
    if (!completion.isCurrent()) return;
    setSubmitting(true);
    const normalizedEmail = email.trim().toLowerCase();
    try {
      const result = await InvitationsService.send(workspaceId, {
        email: normalizedEmail,
        role,
        ...(teamIds && teamIds.length > 0 ? { team_ids: teamIds } : {}),
        ...(spaceIds && spaceIds.length > 0 ? { space_ids: spaceIds } : {}),
      });
      if (completion.isAccountCurrent()) await onReconciled?.(normalizedEmail);
      if (!completion.isCurrent()) return;
      if (result.email_sent) {
        toast({
          title: t("workspaces.invite.sentTitle"),
          description: t("workspaces.invite.sentDescription", { email }),
        });
      } else {
        toast({
          title: t("workspaces.invite.sentNoEmailTitle"),
          description: t("workspaces.invite.sentNoEmailDescription", { email }),
          variant: "destructive",
        });
      }
      onInvited?.(normalizedEmail);
      handleOpenChange(false);
    } catch (error) {
      if (!completion.isCurrent()) return;
      toast({
        title: t("workspaces.invite.errorTitle"),
        description: error instanceof Error ? error.message : t("common.unknownError"),
        variant: "destructive",
      });
    } finally {
      if (completion.isCurrent()) setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("workspaces.invite.title", { workspace: workspaceName })}</DialogTitle>
          <DialogDescription>{t("workspaces.invite.description")}</DialogDescription>
          {seatsUsed !== null && seats !== null && (
            <p className="text-xs text-muted-foreground">
              {t("workspaces.invite.seatUsage", { used: seatsUsed, seats })}
            </p>
          )}
        </DialogHeader>
        <form ref={bindInvitation} onSubmit={handleSubmit} className="space-y-4">
          <InvitationPricingReader reload={reloadPricing} />
          <div className="space-y-1.5">
            <Label htmlFor="invite-email" className="text-xs font-medium">
              {t("workspaces.invite.emailLabel")}
            </Label>
            <Input
              dir="ltr"
              id="invite-email"
              type="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("workspaces.invite.emailPlaceholder")}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium">{t("workspaces.invite.roleLabel")}</Label>
            <div className="flex gap-1.5">
              {(["member", "admin"] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  aria-pressed={role === r}
                  onClick={() => setRole(r)}
                  className={cn(
                    "flex-1 px-3 py-2 rounded-md border text-start transition-colors",
                    "outline-none focus-visible:ring-1 focus-visible:ring-primary/30",
                    role === r
                      ? "border-primary/40 bg-primary/8"
                      : "border-border/70 hover:bg-foreground/4"
                  )}
                >
                  <span
                    className={cn(
                      "block text-xs font-medium",
                      role === r ? "text-foreground" : "text-muted-foreground"
                    )}
                  >
                    {t(`workspaces.invite.role.${r}`)}
                  </span>
                  <span className="block text-[11px] text-muted-foreground mt-0.5">
                    {t(`workspaces.invite.roleDescription.${r}`)}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {!pricingReady && (
            <div className="text-xs text-muted-foreground" role="status">
              {t(
                currentPricing?.status === "error"
                  ? "workspaces.invite.pricingUnavailable"
                  : "workspaces.invite.pricingLoading"
              )}
              {currentPricing?.status === "error" && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void reloadPricing()}
                >
                  {t("common.retry")}
                </Button>
              )}
            </div>
          )}

          {addsBilledSeat && (
            <p className="text-[11px] text-muted-foreground">
              {t("workspaces.invite.seatCost", {
                amount: formatAmount(seatPreview.amount_due, seatPreview.currency),
              })}
            </p>
          )}

          <DialogFooter className="pt-1">
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleOpenChange(false)}
              disabled={submitting}
            >
              {cancelLabel ?? t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!email.trim() || submitting || !pricingReady}>
              {showSpinner && <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />}
              {submitting ? t("workspaces.invite.submitting") : t("workspaces.invite.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
