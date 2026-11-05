export type PendingBusinessSetup = {
  email: string;
  businessName: string;
  logo: File | null;
  latitude: number | null;
  longitude: number | null;
};

const databaseName = 'morfi-pending-business-registration';
const storeName = 'setups';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(storeName)) {
        request.result.createObjectStore(storeName, { keyPath: 'email' });
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error ?? new Error('No se pudo abrir el almacenamiento local.'));
    request.onblocked = () => reject(new Error('El almacenamiento local de MORFI está bloqueado.'));
  });
}

async function transact<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    const request = operation(transaction.objectStore(storeName));
    let result: T;
    request.onsuccess = () => {
      result = request.result;
    };
    transaction.oncomplete = () => {
      database.close();
      resolve(result);
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? request.error ?? new Error('No se pudo guardar el registro pendiente.'));
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error ?? request.error ?? new Error('Se canceló el registro pendiente.'));
    };
  });
}

export function savePendingBusinessSetup(setup: PendingBusinessSetup): Promise<IDBValidKey> {
  return transact('readwrite', store => store.put({
    ...setup,
    email: setup.email.trim().toLowerCase(),
  }));
}

export function getPendingBusinessSetup(email: string): Promise<PendingBusinessSetup | undefined> {
  return transact('readonly', store => store.get(email.trim().toLowerCase()));
}

export function removePendingBusinessSetup(email: string): Promise<undefined> {
  return transact('readwrite', store => store.delete(email.trim().toLowerCase()));
}
