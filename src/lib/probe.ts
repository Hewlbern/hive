import type { DeviceKind } from "./protocol";

export type DeviceProbe = {
  kind: DeviceKind;
  vramMB: number;
  webgpu: boolean;
  safari: boolean;
  ios: boolean;
  note: string;
};

function isSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /Safari/i.test(ua) && !/Chrome|Chromium|Edg|OPR/i.test(ua);
}

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function guessKind(): DeviceKind {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent;
  const mobile = /Mobi|Android|iPhone|iPad|iPod/i.test(ua) ||
    (typeof window !== "undefined" && window.matchMedia("(max-width: 700px)").matches);
  if (mobile) return "phone";
  if (/CrOS|Linux x86_64|Win64|Macintosh/i.test(ua)) {
    // Heuristic: big screens on a desk are desktops.
    if (typeof screen !== "undefined" && screen.width * screen.height >= 1920 * 1080) {
      return /Macintosh|Win64/i.test(ua) && (navigator.hardwareConcurrency ?? 4) >= 12
        ? "desktop"
        : "laptop";
    }
    return "laptop";
  }
  return "laptop";
}

function estimateFromLimits(kind: DeviceKind, webgpu: boolean, safari: boolean, ios: boolean): number {
  if (!webgpu) {
    // CPU path can still run Hive Nano / Hive 15.
    if (kind === "phone") return 160;
    if (kind === "desktop") return 512;
    return 320;
  }
  if (ios || safari) {
    // Safari WebGPU is real on recent versions but memory is tight.
    return kind === "phone" ? 900 : 1800;
  }
  if (kind === "phone") return 1800;
  if (kind === "desktop") return 10240;
  return 6144;
}

export async function probeDevice(): Promise<DeviceProbe> {
  const kind = guessKind();
  const safari = isSafari();
  const ios = isIOS();
  const cpu: DeviceProbe = {
    kind,
    vramMB: estimateFromLimits(kind, false, safari, ios),
    webgpu: false,
    safari,
    ios,
    note: "Running the CPU kernel. Fine for Nano; Qwen needs WebGPU.",
  };

  const gpuProbe = (async (): Promise<DeviceProbe> => {
  let webgpu = false;
  let vramMB = cpu.vramMB;
  let note = cpu.note;

  try {
    const gpu = typeof navigator !== "undefined"
      ? (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<{ limits: { maxBufferSize?: number }; info?: { vendor?: string } } | null> } }).gpu
      : undefined;
    if (gpu) {
      const adapter = await gpu.requestAdapter();
      if (adapter) {
        webgpu = true;
        const limits = adapter.limits;
        const maxBuf = Number(limits.maxBufferSize ?? 0);
        const fromBuf = maxBuf > 0 ? Math.round(maxBuf / (1024 * 1024)) : 0;
        const guessed = estimateFromLimits(kind, true, safari, ios);
        // maxBufferSize is not VRAM, but a large limit usually means a real GPU.
        vramMB = Math.max(guessed, Math.min(fromBuf, kind === "phone" ? 4096 : 24576));
        const info = "info" in adapter ? (adapter as { info?: { vendor?: string; architecture?: string } }).info : undefined;
        const vendor = info?.vendor ?? "gpu";
        note = ios
          ? `iOS WebGPU is available via ${vendor}, but memory is capped. Great as a contributor; don't expect 7B on this phone.`
          : safari
            ? "Safari WebGPU works on recent macOS. Chrome/Edge is still the more reliable path for Qwen."
            : `WebGPU adapter ready (${vendor}). This device can hold layers and, if large enough, a full Qwen checkpoint.`;
      }
    }
  } catch {
    webgpu = false;
    vramMB = estimateFromLimits(kind, false, safari, ios);
    note = "WebGPU probe failed. Hive Nano still runs on CPU.";
  }

  if (!webgpu && (safari || ios)) {
    note =
      "Safari / iOS: WebGPU is limited or missing, and WebRTC may fail on guest Wi-Fi. You can still join, watch tokens, and contribute CPU layers for Nano.";
  }

  return { kind, vramMB, webgpu, safari, ios, note };
  })();

  return Promise.race([
    gpuProbe,
    new Promise<DeviceProbe>((resolve) => {
      setTimeout(() => resolve({ ...cpu, note: "WebGPU probe timed out. Using the CPU kernel." }), 800);
    }),
  ]);
}

const TREES = [
  "oak", "cedar", "pine", "maple", "birch", "willow", "ash", "elm",
  "yew", "larch", "poplar", "alder", "beech", "rowen", "fir", "hemlock",
];

export function defaultDeviceName(id: string): string {
  const n = id.replace(/-/g, "");
  let h = 0;
  for (let i = 0; i < n.length; i++) h = (h * 33 + n.charCodeAt(i)) >>> 0;
  return `${TREES[h % TREES.length]}-${n.slice(0, 4)}`;
}

export function buildingCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  let s = "";
  for (let i = 0; i < 4; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}
