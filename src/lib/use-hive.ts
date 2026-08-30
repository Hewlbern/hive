"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { assignFromRoster, assignSingleDevice } from "./assign";
import { getDeviceId, getStoredName, storeName } from "./device";
import {
  buildCatalog,
  catalogHeadline,
  getModel,
  pickRunnableModel,
  pooledMB,
  sharingMembers,
} from "./models";
import {
  clearSession,
  continueFromSample,
  handleFallbackActivation,
  handleIncomingActivation,
  runGeneration,
  type RunnerHooks,
} from "./engine/runner";
import { defaultDeviceName, probeDevice, type DeviceProbe } from "./probe";
import type {
  CatalogEntryView,
  ChatMessage,
  ClientToServer,
  GenerateRequest,
  LayerAssignment,
  Member,
  PoolSnapshot,
  ServerToClient,
  TopUpRecord,
  WalletSnapshot,
} from "./protocol";
import { CREDIT_PER_TOKEN, DEFAULT_MAX_TOKENS, HEARTBEAT_MS } from "./protocol";
import { HiveMesh } from "./rtc";
import { connectSignal, type SignalClient } from "./signal";

export type HiveState = {
  code: string;
  selfId: string;
  selfName: string;
  members: Member[];
  catalog: CatalogEntryView[];
  assignments: LayerAssignment[];
  pool: PoolSnapshot | null;
  wallet: WalletSnapshot | null;
  history: TopUpRecord[];
  messages: ChatMessage[];
  sharing: boolean;
  probe: DeviceProbe | null;
  selectedModelId: string | null;
  generating: boolean;
  status: string | null;
  error: string | null;
  connected: boolean;
  payFromPool: boolean;
};

const emptyPool = (code: string): PoolSnapshot => ({
  code,
  members: 0,
  sharing: 0,
  pooledMB: 0,
  selectedModelId: null,
  activeModelId: null,
  warning: null,
});

export function useHive(code: string) {
  const [selfId, setSelfId] = useState("");
  useEffect(() => {
    setSelfId(getDeviceId());
  }, []);
  const [state, setState] = useState<HiveState>(() => ({
    code: code.toUpperCase(),
    selfId: "",
    selfName: "you",
    members: [],
    catalog: buildCatalog([]),
    assignments: [],
    pool: emptyPool(code.toUpperCase()),
    wallet: null,
    history: [],
    messages: [],
    sharing: false,
    probe: null,
    selectedModelId: null,
    generating: false,
    status: null,
    error: null,
    connected: false,
    payFromPool: true,
  }));

  const signalRef = useRef<SignalClient | null>(null);
  const meshRef = useRef<HiveMesh | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const requestRef = useRef<GenerateRequest | null>(null);
  const hooksRef = useRef<RunnerHooks | null>(null);
  const sharingRef = useRef(false);
  const probeRef = useRef<DeviceProbe | null>(null);
  const tokenIndexRef = useRef(0);

  const send = useCallback((message: ClientToServer) => {
    signalRef.current?.send(message);
  }, []);

  const emitToken = useCallback(
    (generationId: string, token: string, done: boolean, tokPerSec: number, tokenId?: number) => {
      send({
        type: "token",
        event: {
          generationId,
          index: tokenIndexRef.current++,
          token,
          tokenId,
          done,
          tokPerSec,
        },
      });
    },
    [send],
  );

  useEffect(() => {
    if (!selfId) return;
    let cancelled = false;
    setState((s) => ({ ...s, selfId, selfName: getStoredName() || defaultDeviceName(selfId) }));
    const mesh = new HiveMesh(selfId, {
      sendSignal: (to, payload) => send({ type: "signal", to, payload }),
      onData: (from, data) => {
        if (typeof data !== "string" && requestRef.current) {
          handleIncomingActivation(data, hooksRef.current!);
        }
        void from;
      },
      onState: () => {
        /* roster heartbeats carry quality */
      },
    });
    meshRef.current = mesh;

    const onMessage = (msg: ServerToClient) => {
      if (cancelled) return;
      switch (msg.type) {
        case "welcome":
          setState((s) => ({
            ...s,
            connected: true,
            wallet: msg.wallet,
            pool: msg.pool,
            error: null,
          }));
          if (sharingRef.current && probeRef.current) {
            send({
              type: "share",
              sharing: true,
              vramMB: probeRef.current.vramMB,
              webgpu: probeRef.current.webgpu,
              kind: probeRef.current.kind,
            });
          }
          break;
        case "roster":
          setState((s) => {
            const me = msg.members.find((m) => m.id === selfId);
            return {
              ...s,
              members: msg.members,
              catalog: msg.catalog,
              assignments: msg.assignments,
              pool: msg.pool,
              selectedModelId: msg.pool.selectedModelId ?? s.selectedModelId,
              wallet: s.wallet && me
                ? { ...s.wallet, sessionEarned: Math.max(s.wallet.sessionEarned, me.earnedSession) }
                : s.wallet,
            };
          });
          for (const m of msg.members) {
            if (m.id !== selfId && m.online) void mesh.ensure(m.id);
          }
          if (msg.pool.warning) {
            setState((s) => ({ ...s, status: msg.pool.warning }));
          }
          break;
        case "wallet":
          setState((s) => ({
            ...s,
            wallet: s.wallet
              ? {
                  ...msg.wallet,
                  sessionEarned: Math.max(s.wallet.sessionEarned, msg.wallet.sessionEarned),
                  sessionSpent: Math.max(s.wallet.sessionSpent, msg.wallet.sessionSpent),
                }
              : msg.wallet,
          }));
          break;
        case "signal":
          void mesh.handleSignal(msg.from, msg.payload);
          break;
        case "generate":
          requestRef.current = msg.request;
          tokenIndexRef.current = 0;
          setState((s) => ({
            ...s,
            generating: true,
            status: `Thinking on ${msg.request.modelId}…`,
            messages: [
              ...s.messages,
              {
                id: msg.request.generationId + "-user",
                role: "you",
                authorId: msg.request.requesterId,
                authorName: s.members.find((m) => m.id === msg.request.requesterId)?.name,
                text: msg.request.prompt,
                modelId: msg.request.modelId,
              },
              {
                id: msg.request.generationId,
                role: "swarm",
                text: "",
                modelId: msg.request.modelId,
                live: true,
              },
            ],
          }));
          void startLocalRun(msg.request);
          break;
        case "token":
          if (msg.event.tokenId !== undefined && hooksRef.current) {
            continueFromSample(msg.event.tokenId, hooksRef.current);
          }
          setState((s) => ({
            ...s,
            generating: !msg.event.done,
            messages: s.messages.map((m) =>
              m.id === msg.event.generationId
                ? { ...m, text: m.text + (msg.event.token || ""), live: !msg.event.done }
                : m,
            ),
          }));
          if (msg.event.done) {
            requestRef.current = null;
            clearSession();
          }
          break;
        case "pay":
          setState((s) => {
            const credit = msg.event.splits
              .filter((x) => x.deviceId === selfId)
              .reduce((n, x) => n + x.credits, 0);
            const earnedNow = msg.event.earned?.[selfId];
            const members = s.members.map((m) => {
              const total = msg.event.earned?.[m.id];
              const add = msg.event.splits
                .filter((x) => x.deviceId === m.id)
                .reduce((n, x) => n + x.credits, 0);
              if (total !== undefined) return { ...m, earnedSession: total };
              return add ? { ...m, earnedSession: m.earnedSession + add } : m;
            });
            const prev = s.wallet;
            const wallet = {
              deviceId: selfId,
              balance: msg.event.balances[selfId] ?? prev?.balance ?? 0,
              sessionEarned: Math.max(
                prev?.sessionEarned ?? 0,
                earnedNow ?? (prev?.sessionEarned ?? 0) + credit,
              ),
              sessionSpent:
                msg.event.requesterId === selfId
                  ? (prev?.sessionSpent ?? 0) + msg.event.requesterDebit
                  : (prev?.sessionSpent ?? 0),
              poolBalance: msg.event.poolBalance,
              testMode: prev?.testMode ?? true,
              rail: prev?.rail ?? ("demo" as const),
            };
            return { ...s, wallet, members };
          });
          break;
        case "abort":
          abortRef.current?.abort();
          clearSession();
          requestRef.current = null;
          setState((s) => ({
            ...s,
            generating: false,
            error: msg.reason,
            messages: s.messages.map((m) =>
              m.id === msg.generationId ? { ...m, live: false } : m,
            ),
          }));
          break;
        case "error":
          setState((s) => ({ ...s, error: msg.message, generating: false }));
          break;
        case "activation-fallback":
          if (hooksRef.current) {
            handleFallbackActivation(
              msg.data,
              msg.pos,
              msg.token,
              msg.generationId,
              hooksRef.current,
            );
          }
          break;
      }
    };

    async function startLocalRun(request: GenerateRequest) {
      const meshNow = meshRef.current;
      if (!meshNow) return;
      abortRef.current?.abort();
      const abort = new AbortController();
      abortRef.current = abort;
      const hooks: RunnerHooks = {
        mesh: meshNow,
        selfId,
        sendActivationFallback: (to, data, pos, token) =>
          send({
            type: "activation-fallback",
            generationId: request.generationId,
            to,
            data,
            pos,
            token,
          }),
        emitToken,
        onStatus: (text) => setState((s) => ({ ...s, status: text })),
      };
      hooksRef.current = hooks;
      try {
        await runGeneration(request, hooks, abort.signal);
      } catch (err) {
        setState((s) => ({
          ...s,
          error: err instanceof Error ? err.message : "Generation failed",
          generating: false,
        }));
      }
    }

    const probeP = probeDevice();
    const signal = connectSignal(selfId, onMessage, () => {
      if (cancelled) return;
      const name = getStoredName() || defaultDeviceName(selfId);
      const pending = probeRef.current;
      signal.send({
        type: "join",
        code: code.toUpperCase(),
        member: {
          id: selfId,
          name,
          kind: pending?.kind ?? "laptop",
          vramMB: pending?.vramMB ?? 320,
          webgpu: pending?.webgpu ?? false,
          sharing: sharingRef.current,
          safari: pending?.safari ?? false,
        },
      });
      void probeP.then((probe) => {
        if (cancelled) return;
        probeRef.current = probe;
        setState((s) => ({ ...s, probe, selfName: name }));
        signal.send({
          type: "heartbeat",
          sharing: sharingRef.current,
          vramMB: probe.vramMB,
          webgpu: probe.webgpu,
        });
      });
    });
    signalRef.current = signal;

    const hb = window.setInterval(() => {
      send({
        type: "heartbeat",
        sharing: sharingRef.current,
        vramMB: probeRef.current?.vramMB,
        webgpu: probeRef.current?.webgpu,
      });
    }, HEARTBEAT_MS);

    const onLeave = () => send({ type: "leave" });
    window.addEventListener("pagehide", onLeave);

    void fetch(`/api/ledger?deviceId=${selfId}&code=${code.toUpperCase()}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setState((s) => ({
          ...s,
          history: data.history ?? [],
          wallet: s.wallet
            ? s.wallet
            : {
                deviceId: selfId,
                balance: data.balance ?? 0,
                sessionEarned: 0,
                sessionSpent: 0,
                poolBalance: data.poolBalance ?? 0,
                testMode: data.testMode ?? true,
                rail: "demo",
              },
        }));
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      window.clearInterval(hb);
      window.removeEventListener("pagehide", onLeave);
      onLeave();
      signal.close();
      mesh.close();
      abortRef.current?.abort();
    };
  }, [code, emitToken, selfId, send]);

  const setSharing = useCallback(
    (sharing: boolean) => {
      sharingRef.current = sharing;
      const probe = probeRef.current;
      setState((s) => {
        const self: Member = s.members.find((m) => m.id === selfId) ?? {
          id: selfId,
          name: s.selfName,
          kind: probe?.kind ?? "unknown",
          vramMB: probe?.vramMB ?? 256,
          webgpu: probe?.webgpu ?? false,
          sharing,
          online: true,
          layers: null,
          tokPerSec: 0,
          earnedSession: 0,
          spentSession: 0,
          quality: "good",
          busy: false,
          safari: probe?.safari ?? false,
        };
        const members = s.members.some((m) => m.id === selfId)
          ? s.members.map((m) =>
              m.id === selfId
                ? {
                    ...m,
                    sharing,
                    vramMB: probe?.vramMB ?? m.vramMB,
                    webgpu: probe?.webgpu ?? m.webgpu,
                    kind: probe?.kind ?? m.kind,
                    online: true,
                  }
                : m,
            )
          : [...s.members, { ...self, sharing }];
        const catalog = buildCatalog(members);
        const { model, warning } = pickRunnableModel(s.selectedModelId, members);
        const modelDef = model ? getModel(model.id) : null;
        const assignments = modelDef
          ? modelDef.split === "single"
            ? assignSingleDevice(
                sharingMembers(members).map((m) => ({
                  id: m.id,
                  vramMB: m.vramMB,
                  webgpu: m.webgpu,
                })),
                modelDef.layers,
                modelDef.vramMB,
                modelDef.engine === "web-llm",
              )
            : assignFromRoster(members, modelDef.layers)
          : [];
        return {
          ...s,
          sharing,
          members,
          catalog,
          assignments,
          pool: {
            code: s.code,
            members: members.length,
            sharing: sharingMembers(members).length,
            pooledMB: pooledMB(members),
            selectedModelId: s.selectedModelId,
            activeModelId: model?.id ?? null,
            warning,
          },
          status: warning ?? catalogHeadline(members),
        };
      });
      send({
        type: "share",
        sharing,
        vramMB: probe?.vramMB ?? 256,
        webgpu: probe?.webgpu ?? false,
        kind: probe?.kind ?? "unknown",
      });
    },
    [selfId, send],
  );

  const selectModel = useCallback(
    (modelId: string) => {
      setState((s) => ({ ...s, selectedModelId: modelId }));
      send({ type: "select-model", modelId });
    },
    [send],
  );

  const sendPrompt = useCallback(
    (text: string) => {
      const prompt = text.trim();
      if (!prompt) return;
      const generationId = crypto.randomUUID();
      const modelId = state.selectedModelId || state.pool?.activeModelId || "hive-nano";
      send({
        type: "generate",
        request: {
          generationId,
          requesterId: selfId,
          modelId,
          prompt,
          maxTokens: DEFAULT_MAX_TOKENS,
          temperature: 0.8,
          assignments: [],
          payFromPool: state.payFromPool,
        },
      });
    },
    [selfId, send, state.payFromPool, state.pool?.activeModelId, state.selectedModelId],
  );

  const rename = useCallback(
    (name: string) => {
      const next = name.slice(0, 24);
      storeName(next);
      setState((s) => ({ ...s, selfName: next }));
      send({ type: "rename", name: next });
    },
    [send],
  );

  const topUp = useCallback(
    async (pack: "5" | "20" | "50", rail: "demo" | "stripe" | "lightning" = "demo", target: "wallet" | "pool" = "wallet") => {
      const res = await fetch("/api/topup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceId: selfId,
          code: state.code,
          pack,
          rail,
          target,
        }),
      });
      const data = await res.json();
      if (data.invoice) return data as { invoice: string; credits: number; pack: string; rail: string };
      if (data.clientSecret) return data as { clientSecret: string; credits: number };
      setState((s) => ({
        ...s,
        status: `+${data.credits} credits (${data.rail === "demo" ? "TEST" : data.rail})`,
      }));
      return data;
    },
    [selfId, state.code],
  );

  const confirmLightning = useCallback(
    async (pack: string) => {
      await fetch("/api/topup/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId: selfId, code: state.code, pack }),
      });
    },
    [selfId, state.code],
  );

  const abort = useCallback(() => {
    abortRef.current?.abort();
    if (requestRef.current) send({ type: "abort", generationId: requestRef.current.generationId });
  }, [send]);

  const setPayFromPool = useCallback((payFromPool: boolean) => {
    setState((s) => ({ ...s, payFromPool }));
  }, []);

  const me = state.members.find((m) => m.id === selfId) ?? null;

  return {
    ...state,
    me,
    creditPerToken: CREDIT_PER_TOKEN,
    setSharing,
    selectModel,
    sendPrompt,
    rename,
    topUp,
    confirmLightning,
    abort,
    setPayFromPool,
    clearError: () => setState((s) => ({ ...s, error: null })),
  };
}
