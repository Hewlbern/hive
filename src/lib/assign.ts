import type { LayerAssignment, Member } from "./protocol";
import { sharingMembers } from "./models";

export type AssignInput = {
  id: string;
  vramMB: number;
};

/**
 * Contiguous pipeline-parallel assignment.
 * Bigger devices get more layers. Devices are ordered strongest → weakest
 * along the pipeline so early (embedding-adjacent) and late (head) stages
 * land on capable machines when the split is uneven.
 */
export function assignLayers(
  devices: AssignInput[],
  nLayers: number,
): LayerAssignment[] {
  if (nLayers <= 0) return [];
  const capable = devices
    .filter((d) => d.vramMB > 0)
    .sort((a, b) => b.vramMB - a.vramMB || a.id.localeCompare(b.id));
  if (capable.length === 0) return [];

  const workers = capable.slice(0, nLayers);
  const total = workers.reduce((sum, d) => sum + d.vramMB, 0);

  const counts = workers.map(() => 0);
  // Largest remainder method so every worker with a seat gets ≥1 layer
  // and the sum is exactly nLayers, proportional to VRAM.
  const raw = workers.map((d) => (nLayers * d.vramMB) / total);
  for (let i = 0; i < workers.length; i++) {
    counts[i] = Math.max(1, Math.floor(raw[i]));
  }
  let assigned = counts.reduce((a, b) => a + b, 0);
  if (assigned > nLayers) {
    // Trim from the weakest while leaving at least 1
    for (let i = workers.length - 1; i >= 0 && assigned > nLayers; i--) {
      if (counts[i] > 1) {
        counts[i] -= 1;
        assigned -= 1;
      }
    }
  } else if (assigned < nLayers) {
    const remainders = workers
      .map((d, i) => ({ i, r: raw[i] - Math.floor(raw[i]) }))
      .sort((a, b) => b.r - a.r);
    let leftover = nLayers - assigned;
    let cursor = 0;
    while (leftover > 0) {
      counts[remainders[cursor % remainders.length].i] += 1;
      leftover -= 1;
      cursor += 1;
    }
  }

  // Pipeline order: strongest first (embed + early layers), then down.
  let start = 0;
  const out: LayerAssignment[] = [];
  for (let i = 0; i < workers.length; i++) {
    const end = start + counts[i];
    if (end > start) {
      out.push({ deviceId: workers[i].id, start, end: Math.min(end, nLayers) });
      start = Math.min(end, nLayers);
    }
  }
  if (out.length && out[out.length - 1].end < nLayers) {
    out[out.length - 1].end = nLayers;
  }
  return out.filter((a) => a.end > a.start);
}

export function assignFromRoster(members: Member[], nLayers: number): LayerAssignment[] {
  return assignLayers(
    sharingMembers(members).map((m) => ({ id: m.id, vramMB: m.vramMB })),
    nLayers,
  );
}

/** WebLLM (and any single-device engine) cannot split. Pick the strongest fit. */
export function assignSingleDevice(
  devices: (AssignInput & { webgpu?: boolean })[],
  nLayers: number,
  minVramMB: number,
  requireWebgpu = true,
): LayerAssignment[] {
  const fit = devices
    .filter((d) => d.vramMB >= minVramMB && (!requireWebgpu || d.webgpu))
    .sort((a, b) => b.vramMB - a.vramMB || a.id.localeCompare(b.id));
  if (!fit[0] || nLayers <= 0) return [];
  return [{ deviceId: fit[0].id, start: 0, end: nLayers }];
}

export function layerShare(assignment: LayerAssignment, nLayers: number): number {
  if (nLayers <= 0) return 0;
  return (assignment.end - assignment.start) / nLayers;
}

export function applyAssignments(members: Member[], assignments: LayerAssignment[]): Member[] {
  const byId = new Map(assignments.map((a) => [a.deviceId, a]));
  return members.map((m) => {
    const a = byId.get(m.id);
    return { ...m, layers: a ? [a.start, a.end] : null };
  });
}
