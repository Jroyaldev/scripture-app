import type React from "react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { isTopLayer, useLayer } from "../layerStack.js";
import type {
  WorkspaceConfirmation,
  WorkspaceDecision,
} from "../utils/studyWorkspace.js";

export interface WorkspaceDecisionAction {
  decision: WorkspaceDecision;
  label: string;
  tone: "primary" | "danger" | "secondary";
}

export interface WorkspaceDecisionPresentation {
  title: string;
  description: string;
  actions: WorkspaceDecisionAction[];
}

function plural(count: number, singular: string, multiple = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : multiple}`;
}

export function workspaceDecisionPresentation(
  confirmation: WorkspaceConfirmation,
): WorkspaceDecisionPresentation {
  if (confirmation.kind === "passage-dependencies") {
    const count = confirmation.dependentEntityIds.length;
    return {
      title: "Close this passage?",
      description: `${plural(count, "research tab")} opened from it can stay in this study or close with it.`,
      actions: [
        { decision: "keep-research", label: "Keep research", tone: "primary" },
        {
          decision: "close-passage-and-research",
          label: `Close passage + ${count === 1 ? "research" : "research tabs"}`,
          tone: "danger",
        },
      ],
    };
  }

  if (confirmation.kind === "sole-group-passage") {
    return {
      title: "Close this study?",
      description: "This is the study's only passage. Closing it also closes the research gathered with it.",
      actions: [{ decision: "close-study", label: "Close study", tone: "danger" }],
    };
  }

  if (confirmation.kind === "close-study") {
    return {
      title: "Close this study?",
      description: `${plural(confirmation.tabIds.length, "tab")} will move to Recently closed and can be reopened.`,
      actions: [{ decision: "close-study", label: "Close study", tone: "danger" }],
    };
  }

  if (confirmation.kind === "move-branch") {
    return {
      title: "Move this passage branch?",
      description: `${plural(confirmation.dependentEntityIds.length, "research tab")} opened from this passage will move with it.`,
      actions: [{ decision: "move-branch", label: "Move passage + research", tone: "primary" }],
    };
  }

  if (confirmation.kind === "move-entity-context") {
    return {
      title: "Move this research tab?",
      description: "Its opening passage will be copied into the destination study so the research keeps its context.",
      actions: [{ decision: "copy-origin-passage", label: "Copy context + move", tone: "primary" }],
    };
  }

  return {
    title: "Move this study's home passage?",
    description: "Keep this study intact, or leave a copy of its home passage here and move only this passage branch.",
    actions: [
      { decision: "duplicate-home", label: "Leave a copy + move branch", tone: "primary" },
      { decision: "move-study", label: "Move entire study", tone: "secondary" },
    ],
  };
}

interface Props {
  confirmation: WorkspaceConfirmation;
  onDecide: (decision: WorkspaceDecision) => void;
}

export function WorkspaceDecisionDialog({
  confirmation,
  onDecide,
}: Props): React.JSX.Element {
  const panelRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const restoreFocusRef = useRef(true);
  const onDecideRef = useRef(onDecide);
  const layerRef = useLayer("dialog");
  const presentation = workspaceDecisionPresentation(confirmation);

  useEffect(() => {
    onDecideRef.current = onDecide;
  }, [onDecide]);

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const focusTimer = window.setTimeout(() => cancelRef.current?.focus(), 0);
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (!isTopLayer(layerRef.current)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        onDecideRef.current("cancel");
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const controls = [...panelRef.current.querySelectorAll<HTMLButtonElement>("button:not([disabled])")];
      const first = controls[0];
      const last = controls.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", handleKeyDown, true);
      const target = returnFocusRef.current;
      window.setTimeout(() => {
        if (restoreFocusRef.current && target?.isConnected) target.focus({ preventScroll: true });
      }, 0);
    };
  }, [layerRef]);

  const decide = (decision: WorkspaceDecision): void => {
    restoreFocusRef.current = decision === "cancel";
    onDecide(decision);
  };

  /* PORTALLED TO THE BODY, and this is a correctness fix rather than a
     preference. `.app-shell` carries `isolation: isolate`, so it opens a
     stacking context and every z-index inside it — including this dialog's
     1360 — is scoped to that context. The app-shell itself participates in the
     root context at `z-index: auto`, i.e. level zero. Popovers portal to the
     body and put their hit shield at 900, which is above zero, so while ANY
     popover was open this dialog painted underneath its scrim: the question was
     visible, dimmed, and unclickable, and the reader had to dismiss the menu by
     clicking outside it before they could answer the question that menu had
     asked them. A modal that a click cannot reach is not a modal.

     Portalling puts it in the root context beside the scrims it must outrank,
     where 1360 means what it says. The material classes come with it for the
     same reason Popover and Tooltip copy them: design tokens are declared on
     the shell, and a portalled node leaves that subtree behind. */
  const shell = document.querySelector(".app-shell");
  const materialClasses = shell
    ? [...shell.classList].filter((name) => name === "dark" || name.startsWith("theme-")).join(" ")
    : "";

  return createPortal(
    <div
      className={`workspace-decision-root ${materialClasses}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="workspace-decision-title"
      aria-describedby="workspace-decision-description"
      data-floating-layer="dialog"
      data-study-decision={confirmation.kind}
    >
      <button
        type="button"
        className="floating-dialog-scrim workspace-decision-scrim"
        aria-label="Cancel workspace change"
        onClick={() => decide("cancel")}
      />
      <div ref={panelRef} className="floating-dialog-surface workspace-decision-panel" tabIndex={-1}>
        <span className="workspace-decision-kicker">Study tabs</span>
        <h2 id="workspace-decision-title">{presentation.title}</h2>
        <p id="workspace-decision-description">{presentation.description}</p>
        <div className="workspace-decision-actions">
          <button
            ref={cancelRef}
            type="button"
            className="workspace-decision-action is-cancel"
            onClick={() => decide("cancel")}
          >
            Cancel
          </button>
          {presentation.actions.map((action) => (
            <button
              type="button"
              className={`workspace-decision-action is-${action.tone}`}
              data-study-decision-action={action.decision}
              key={action.decision}
              onClick={() => decide(action.decision)}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
