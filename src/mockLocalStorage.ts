import { applyStorageSnapshot } from './storageKeys';

const DEBUG_STORAGE_FIXTURE_FILENAME = 'localstorage.debug.json';
const MOCK_STORAGE_INSTALLED_FLAG = '__nihongoFlashMockStorageInstalled';

class InMemoryStorage implements Storage {
  private store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key) ?? null : null;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

const installStorageMethodPatch = (
  memoryStorage: Storage,
): void => {
  const storagePrototype = Storage.prototype;
  const originalGetItem = storagePrototype.getItem;
  const originalSetItem = storagePrototype.setItem;
  const originalRemoveItem = storagePrototype.removeItem;
  const originalClear = storagePrototype.clear;
  const originalKey = storagePrototype.key;
  const originalLengthDescriptor = Object.getOwnPropertyDescriptor(storagePrototype, 'length');

  storagePrototype.getItem = function getItem(this: Storage, key: string): string | null {
    if (this === window.localStorage) {
      return memoryStorage.getItem(key);
    }

    return originalGetItem.call(this, key);
  };

  storagePrototype.setItem = function setItem(this: Storage, key: string, value: string): void {
    if (this === window.localStorage) {
      memoryStorage.setItem(key, value);
      return;
    }

    originalSetItem.call(this, key, value);
  };

  storagePrototype.removeItem = function removeItem(this: Storage, key: string): void {
    if (this === window.localStorage) {
      memoryStorage.removeItem(key);
      return;
    }

    originalRemoveItem.call(this, key);
  };

  storagePrototype.clear = function clear(this: Storage): void {
    if (this === window.localStorage) {
      memoryStorage.clear();
      return;
    }

    originalClear.call(this);
  };

  storagePrototype.key = function key(this: Storage, index: number): string | null {
    if (this === window.localStorage) {
      return memoryStorage.key(index);
    }

    return originalKey.call(this, index);
  };

  if (originalLengthDescriptor?.get) {
    Object.defineProperty(storagePrototype, 'length', {
      configurable: true,
      enumerable: originalLengthDescriptor.enumerable ?? false,
      get(this: Storage) {
        if (this === window.localStorage) {
          return memoryStorage.length;
        }

        return originalLengthDescriptor.get?.call(this) ?? 0;
      },
    });
  }
};

export const installMockLocalStorage = async (): Promise<void> => {
  if (typeof window === 'undefined') {
    return;
  }

  if ((window as typeof window & Record<string, unknown>)[MOCK_STORAGE_INSTALLED_FLAG]) {
    return;
  }

  const memoryStorage = new InMemoryStorage();

  try {
    const response = await fetch(`${import.meta.env.BASE_URL}${DEBUG_STORAGE_FIXTURE_FILENAME}`, {
      cache: 'no-store',
    });

    if (response.ok) {
      applyStorageSnapshot(memoryStorage, await response.json());
    }
  } catch {
    // Ignore fixture load failures so mock mode can still boot with empty storage.
  }

  installStorageMethodPatch(memoryStorage);
  (window as typeof window & Record<string, unknown>)[MOCK_STORAGE_INSTALLED_FLAG] = true;
};
