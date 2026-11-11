function openStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("morfi-push", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("values");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function pushOwner(
  userId?: string | null,
): Promise<string | null> {
  const db = await openStore();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(
        "values",
        userId === undefined ? "readonly" : "readwrite",
      );
      const s = tx.objectStore("values");
      const r =
        userId === undefined
          ? s.get("owner")
          : userId === null
            ? s.delete("owner")
            : s.put(userId, "owner");
      let owner: string | null = null;
      r.onsuccess = () => {
        owner = userId === undefined ? (r.result ?? null) : (userId ?? null);
      };
      tx.oncomplete = () => resolve(owner);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
export async function claimOrderNotice(key: string): Promise<boolean> {
  const db = await openStore();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("values", "readwrite");
      const s = tx.objectStore("values");
      const r = s.get(key);
      let claimed = false;
      r.onsuccess = () => {
        if (!r.result || Date.now() - r.result > 86400000) {
          claimed = true;
          s.put(Date.now(), key);
        }
      };
      tx.oncomplete = () => resolve(claimed);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
