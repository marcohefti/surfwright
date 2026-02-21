import type { ActionAssertionReport, ActionProofEnvelope, ActionTimingMs, SessionSource } from "../types.js";

export type TargetSelectOptionReport = {
  ok: true;
  sessionId: string;
  sessionSource: SessionSource;
  targetId: string;
  actionId: string;
  selector: string;
  selectedBy: "value" | "label" | "index";
  selectedValue: string | null;
  selectedText: string | null;
  selectedIndex: number | null;
  url: string;
  title: string;
  proof?: {
    action: "select-option";
    selectedBy: "value" | "label" | "index";
    selectedValue: string | null;
    selectedText: string | null;
    selectedIndex: number | null;
    finalUrl: string;
  };
  proofEnvelope?: ActionProofEnvelope;
  assertions?: ActionAssertionReport | null;
  timingMs: ActionTimingMs;
};
