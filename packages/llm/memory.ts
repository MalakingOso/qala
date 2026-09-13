// Coach-memory proposals: Gemma suggests dated, sourced facts after
// check-ins; the athlete accepts or rejects each one before it joins
// the visible, editable coach-memory document.

export type MemorySource = "user" | "gemma" | "engine";

export type ProposalStatus = "proposed" | "accepted" | "rejected";

export interface MemoryProposal {
  id: string;
  date: string;
  source: MemorySource;
  text: string;
  status: ProposalStatus;
}

let proposalCounter = 0;

export function proposeMemories(
  items: { text: string; source: MemorySource; date?: string }[],
): MemoryProposal[] {
  return items.map((item) => {
    proposalCounter += 1;
    return {
      id: `mem-${Date.now().toString(36)}-${proposalCounter}`,
      date: item.date ?? new Date().toISOString().slice(0, 10),
      source: item.source,
      text: item.text,
      status: "proposed" as ProposalStatus,
    };
  });
}

function setStatus(
  list: MemoryProposal[],
  id: string,
  status: ProposalStatus,
): MemoryProposal[] {
  return list.map((p) => (p.id === id ? { ...p, status } : p));
}

/** Accept one proposal; returns a new list, input untouched. */
export function acceptProposal(
  list: MemoryProposal[],
  id: string,
): MemoryProposal[] {
  return setStatus(list, id, "accepted");
}

/** Reject one proposal; returns a new list, input untouched. */
export function rejectProposal(
  list: MemoryProposal[],
  id: string,
): MemoryProposal[] {
  return setStatus(list, id, "rejected");
}

/** Proposals still awaiting a decision. */
export function pendingProposals(list: MemoryProposal[]): MemoryProposal[] {
  return list.filter((p) => p.status === "proposed");
}

/** Accepted facts, in the shape the prompt context consumes. */
export function acceptedMemories(
  list: MemoryProposal[],
): { id: string; date: string; source: MemorySource; text: string }[] {
  return list
    .filter((p) => p.status === "accepted")
    .map((p) => ({ id: p.id, date: p.date, source: p.source, text: p.text }));
}

/** JSON round-trip for persisting proposals in the user document. */
export function serializeProposals(list: MemoryProposal[]): string {
  return JSON.stringify(list);
}

export function deserializeProposals(json: string): MemoryProposal[] {
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed)) throw new Error("proposals JSON must be an array");
  return parsed.map((entry) => {
    const p = entry as Record<string, unknown>;
    if (
      typeof p["id"] !== "string" ||
      typeof p["date"] !== "string" ||
      typeof p["text"] !== "string" ||
      (p["source"] !== "user" && p["source"] !== "gemma" && p["source"] !== "engine") ||
      (p["status"] !== "proposed" && p["status"] !== "accepted" && p["status"] !== "rejected")
    ) {
      throw new Error("invalid memory proposal entry");
    }
    return {
      id: p["id"],
      date: p["date"],
      source: p["source"],
      text: p["text"],
      status: p["status"],
    } as MemoryProposal;
  });
}
