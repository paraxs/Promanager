export const uid = (): string =>
  globalThis.crypto?.randomUUID?.() ?? `id_${Math.random().toString(36).slice(2, 11)}`;

export const nowIso = (): string => new Date().toISOString();
