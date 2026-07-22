import type React from "react";
import { useEffect, useRef } from "react";
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

  return (
    <div
      className="workspace-decision-root"
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
    </div>
  );
}
