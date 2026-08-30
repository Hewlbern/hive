import type { SignalPayload } from "./protocol";

export type IceConfig = {
  stun: string[];
  turnUrl?: string;
  turnUser?: string;
  turnCred?: string;
};

export function iceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = (process.env.NEXT_PUBLIC_STUN_URLS || "stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((urls) => ({ urls }));
  const turnUrl = process.env.NEXT_PUBLIC_TURN_URL;
  const turnUser = process.env.NEXT_PUBLIC_TURN_USERNAME;
  const turnCred = process.env.NEXT_PUBLIC_TURN_CREDENTIAL;
  if (turnUrl && turnUser && turnCred) {
    servers.push({ urls: turnUrl, username: turnUser, credential: turnCred });
  }
  return servers;
}

type Handlers = {
  sendSignal: (to: string, payload: SignalPayload) => void;
  onData: (from: string, data: ArrayBuffer | string) => void;
  onState: (from: string, state: RTCPeerConnectionState) => void;
};

/**
 * Polite mesh. The peer with the lexicographically smaller id is polite
 * (rolls back on glare). Data channels carry activations; tokens still
 * fan out on the signaling plane so a blocked NAT never hides the words.
 */
export class HiveMesh {
  private readonly selfId: string;
  private readonly handlers: Handlers;
  private readonly peers = new Map<string, RTCPeerConnection>();
  private readonly channels = new Map<string, RTCDataChannel>();
  private readonly pendingIce = new Map<string, RTCIceCandidateInit[]>();

  constructor(selfId: string, handlers: Handlers) {
    this.selfId = selfId;
    this.handlers = handlers;
  }

  quality(remoteId: string): "good" | "ok" | "poor" | "offline" {
    const pc = this.peers.get(remoteId);
    const ch = this.channels.get(remoteId);
    if (!pc) return "offline";
    if (ch?.readyState === "open" && pc.connectionState === "connected") return "good";
    if (pc.connectionState === "connecting" || ch?.readyState === "connecting") return "ok";
    if (pc.connectionState === "disconnected") return "poor";
    return "offline";
  }

  connected(remoteId: string): boolean {
    return this.channels.get(remoteId)?.readyState === "open";
  }

  async ensure(remoteId: string) {
    if (remoteId === this.selfId) return;
    if (this.channels.get(remoteId)?.readyState === "open") return;
    const pc = this.getPc(remoteId);
    const polite = this.selfId < remoteId;
    if (!polite && !this.channels.has(remoteId)) {
      const ch = pc.createDataChannel("hive", { ordered: true });
      this.bindChannel(remoteId, ch);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.handlers.sendSignal(remoteId, { kind: "offer", sdp: offer.sdp || "" });
    }
  }

  async handleSignal(from: string, payload: SignalPayload) {
    const pc = this.getPc(from);
    if (payload.kind === "offer") {
      if (pc.signalingState !== "stable" && this.selfId < from) {
        await pc.setLocalDescription({ type: "rollback" });
      }
      await pc.setRemoteDescription({ type: "offer", sdp: payload.sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.handlers.sendSignal(from, { kind: "answer", sdp: answer.sdp || "" });
      await this.flushIce(from);
    } else if (payload.kind === "answer") {
      if (pc.signalingState === "have-local-offer") {
        await pc.setRemoteDescription({ type: "answer", sdp: payload.sdp });
        await this.flushIce(from);
      }
    } else if (payload.kind === "ice") {
      if (payload.candidate) {
        const cand = JSON.parse(payload.candidate) as RTCIceCandidateInit;
        if (pc.remoteDescription) {
          try {
            await pc.addIceCandidate(cand);
          } catch {
            /* ignore */
          }
        } else {
          const q = this.pendingIce.get(from) ?? [];
          q.push(cand);
          this.pendingIce.set(from, q);
        }
      }
    }
  }

  send(remoteId: string, data: ArrayBuffer | string): boolean {
    const ch = this.channels.get(remoteId);
    if (!ch || ch.readyState !== "open") return false;
    if (typeof data === "string") ch.send(data);
    else ch.send(new Uint8Array(data));
    return true;
  }

  close() {
    for (const pc of this.peers.values()) pc.close();
    this.peers.clear();
    this.channels.clear();
  }

  private getPc(remoteId: string): RTCPeerConnection {
    let pc = this.peers.get(remoteId);
    if (pc) return pc;
    pc = new RTCPeerConnection({ iceServers: iceServers() });
    pc.onicecandidate = (ev) => {
      this.handlers.sendSignal(remoteId, {
        kind: "ice",
        candidate: ev.candidate ? JSON.stringify(ev.candidate.toJSON()) : null,
        mid: ev.candidate?.sdpMid ?? null,
      });
    };
    pc.onconnectionstatechange = () => {
      this.handlers.onState(remoteId, pc!.connectionState);
    };
    pc.ondatachannel = (ev) => this.bindChannel(remoteId, ev.channel);
    this.peers.set(remoteId, pc);
    return pc;
  }

  private bindChannel(remoteId: string, ch: RTCDataChannel) {
    this.channels.set(remoteId, ch);
    ch.binaryType = "arraybuffer";
    ch.onmessage = (ev) => this.handlers.onData(remoteId, ev.data as ArrayBuffer | string);
  }

  private async flushIce(remoteId: string) {
    const pc = this.peers.get(remoteId);
    const q = this.pendingIce.get(remoteId) ?? [];
    this.pendingIce.delete(remoteId);
    if (!pc) return;
    for (const c of q) {
      try {
        await pc.addIceCandidate(c);
      } catch {
        /* ignore */
      }
    }
  }
}

const MAGIC = 0x48495645; // HIVE

export function encodeActivation(args: {
  generationIdHash: number;
  pos: number;
  token: number;
  hidden: Float32Array;
}): ArrayBuffer {
  const buf = new ArrayBuffer(20 + args.hidden.byteLength);
  const view = new DataView(buf);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, args.generationIdHash, true);
  view.setUint32(8, args.pos, true);
  view.setUint32(12, args.token, true);
  view.setUint32(16, args.hidden.length, true);
  new Float32Array(buf, 20, args.hidden.length).set(args.hidden);
  return buf;
}

export function decodeActivation(data: ArrayBuffer): {
  generationIdHash: number;
  pos: number;
  token: number;
  hidden: Float32Array;
} | null {
  if (data.byteLength < 20) return null;
  const view = new DataView(data);
  if (view.getUint32(0, true) !== MAGIC) return null;
  const dim = view.getUint32(16, true);
  return {
    generationIdHash: view.getUint32(4, true),
    pos: view.getUint32(8, true),
    token: view.getUint32(12, true),
    hidden: new Float32Array(data.slice(20, 20 + dim * 4)),
  };
}

export function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
