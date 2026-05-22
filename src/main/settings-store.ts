/**
 * settings-store — wrapper sobre electron-store pra persistir UndrSettings.
 *
 * electron-store v10 e ESM-only, mas o main bundle e CJS. Por isso fazemos
 * dynamic import (init() retorna promise) e cacheamos o singleton.
 *
 * Validacao de input acontece em validateSetting() antes do store aceitar —
 * dado invalido não corrompe disk.
 */

import {
  DEFAULT_SETTINGS,
  validateSetting,
  type UndrSettings,
} from '../shared/settings-types';

// Tipo mínimo do electron-store que usamos. Evita depender da typing real
// (que tem generics complexos com Conf).
interface StoreLike<T> {
  get<K extends keyof T>(key: K): T[K] | undefined;
  get<K extends keyof T>(key: K, defaultValue: T[K]): T[K];
  set<K extends keyof T>(key: K, value: T[K]): void;
  set(values: Partial<T>): void;
  delete<K extends keyof T>(key: K): void;
  clear(): void;
  store: T;
  readonly path: string;
}

let storePromise: Promise<StoreLike<UndrSettings>> | null = null;

async function getStore(): Promise<StoreLike<UndrSettings>> {
  if (storePromise) return storePromise;
  storePromise = (async () => {
    // Dynamic import porque electron-store v10 e ESM-only (CJS-friendly via await import)
    const mod: unknown = await import('electron-store');
    // electron-store v10 exporta como default em modules ESM. Tentativa de resolução
    // defensiva: usa .default se existe, senao usa o módulo direto (compat futuro).
    type StoreCtor = new (opts?: Record<string, unknown>) => StoreLike<UndrSettings>;
    const ElectronStore: StoreCtor | undefined =
      (mod as { default?: StoreCtor }).default ?? (mod as StoreCtor);
    if (typeof ElectronStore !== 'function') {
      throw new Error(
        '[settings] electron-store não expoe construtor reconhecivel (mod.default ausente ou módulo não callable)'
      );
    }
    const store = new ElectronStore({
      name: 'settings',
      defaults: DEFAULT_SETTINGS,
      // Conf valida que o JSON do disk e parseavel; se não for, recria com defaults
      clearInvalidConfig: true,
    });
    console.log('[settings] store ready at', store.path);
    return store;
  })();
  return storePromise;
}

/** Le todas as settings (merge defaults + persistidas). */
export async function readAllSettings(): Promise<UndrSettings> {
  const store = await getStore();
  const out: UndrSettings = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof UndrSettings>) {
    const raw = store.get(key);
    const validated = raw === undefined ? null : validateSetting(key, raw);
    if (validated !== null) {
      (out as any)[key] = validated;
    }
  }
  return out;
}

/** Le uma key especifica. Retorna default se não definida ou invalida. */
export async function readSetting<K extends keyof UndrSettings>(key: K): Promise<UndrSettings[K]> {
  const store = await getStore();
  const raw = store.get(key);
  if (raw === undefined) return DEFAULT_SETTINGS[key];
  const validated = validateSetting(key, raw);
  return validated === null ? DEFAULT_SETTINGS[key] : validated;
}

/**
 * Atualiza uma key. Retorna o valor efetivamente salvo (após validacao/clamp).
 * Throw se key invalida ou validacao falhar.
 */
export async function writeSetting<K extends keyof UndrSettings>(
  key: K,
  value: unknown,
): Promise<UndrSettings[K]> {
  if (!(key in DEFAULT_SETTINGS)) {
    throw new Error(`unknown setting key: ${String(key)}`);
  }
  const validated = validateSetting(key, value);
  if (validated === null) {
    throw new Error(`invalid value for setting ${String(key)}`);
  }
  const store = await getStore();
  store.set(key, validated);
  return validated;
}

/** Reseta todas as settings pros defaults. Retorna o snapshot novo. */
export async function resetAllSettings(): Promise<UndrSettings> {
  const store = await getStore();
  store.clear();
  // electron-store mantem defaults via construtor, mas .clear() remove tudo;
  // re-set explicito garante consistencia (caso o user tenha um state weird).
  store.set(DEFAULT_SETTINGS as Partial<UndrSettings>);
  return { ...DEFAULT_SETTINGS };
}

/** Reseta uma key especifica pro default. Retorna o valor default. */
export async function resetSetting<K extends keyof UndrSettings>(key: K): Promise<UndrSettings[K]> {
  if (!(key in DEFAULT_SETTINGS)) {
    throw new Error(`unknown setting key: ${String(key)}`);
  }
  const store = await getStore();
  store.delete(key);
  return DEFAULT_SETTINGS[key];
}
