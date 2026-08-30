import type { ClientToServer, ServerToClient } from "./protocol";

export type SignalClient = {
  send: (message: ClientToServer) => void;
  close: () => void;
};

export function connectSignal(
  deviceId: string,
  onMessage: (msg: ServerToClient) => void,
  onOpen?: () => void,
): SignalClient {
  const es = new EventSource(`/api/signal?deviceId=${encodeURIComponent(deviceId)}`);
  es.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data) as ServerToClient | { type: "ready" };
      if (data.type === "ready") {
        if (!opened) {
          opened = true;
          for (const m of queue) void post(deviceId, m);
          queue.length = 0;
          onOpen?.();
        }
        return;
      }
      onMessage(data as ServerToClient);
    } catch {
      /* ignore malformed */
    }
  };

  const queue: ClientToServer[] = [];
  let opened = false;
  es.onopen = () => {
    /* wait for the first `ready` so the hub subscriber exists */
  };

  return {
    send(message) {
      if (!opened) {
        queue.push(message);
        return;
      }
      void post(deviceId, message);
    },
    close() {
      es.close();
    },
  };
}

async function post(deviceId: string, message: ClientToServer) {
  try {
    await fetch("/api/signal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId, message }),
    });
  } catch (err) {
    console.warn("[hive] signal post failed", err);
  }
}
