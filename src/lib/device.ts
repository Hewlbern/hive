export function getDeviceId(): string {
  if (typeof window === "undefined") return "server";
  const key = "hive.deviceId";
  let id = window.localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    window.localStorage.setItem(key, id);
  }
  return id;
}

export function getStoredName(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem("hive.deviceName");
}

export function storeName(name: string) {
  window.localStorage.setItem("hive.deviceName", name);
}
