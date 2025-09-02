export default class CacheManager {
    constructor(dbName, storeName, dbVersion = 1) {
        this.dbName = dbName;
        this.storeName = storeName;
        this.dbVersion = dbVersion;
        this.db = null;
    }

    init() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(this.dbName, this.dbVersion);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    db.createObjectStore(this.storeName);
                }
            };
            req.onsuccess = () => {
                this.db = req.result;
                resolve(this.db);
            };
            req.onerror = () => reject(req.error);
        });
    }

    withStore(mode, callback) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(this.storeName, mode);
            const store = tx.objectStore(this.storeName);
            callback(store);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    get(key) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(this.storeName, 'readonly');
            const req = tx.objectStore(this.storeName).get(key);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    put(key, value) { return this.withStore('readwrite', store => store.put(value, key)); }

    delete(key) { return this.withStore('readwrite', store => store.delete(key)); }

    clear() { return this.withStore('readwrite', store => store.clear()); }

    keys() {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(this.storeName, 'readonly');
            const req = tx.objectStore(this.storeName).getAllKeys();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    // public

    mediaKey(shaderIndex, slotIndex) {
        return `${shaderIndex};${slotIndex}`;
    }
    putMedia(shaderIndex, slotIndex, val) {
        return this.put(this.mediaKey(shaderIndex, slotIndex), val);
    }
    deleteMedia(shaderIndex, slotIndex) {
        return this.delete(this.mediaKey(shaderIndex, slotIndex));
    }
    getMedia(shaderIndex, slotIndex) {
        return this.get(this.mediaKey(shaderIndex, slotIndex));
    }

    putControlSchema(idx, val) {
        return this.put(`${idx};controlSchema`, val);
    }
    deleteControlSchema(shaderIndex) {
        return this.delete(`${shaderIndex};controlSchema`);
    }
    getControlSchema(shaderIndex) {
        return this.get(`${shaderIndex};controlSchema`);
    }

    putControlState(shaderIndex, val) {
        return this.put(`controls;${shaderIndex}`, val);
    }
    deleteControlState(shaderIndex) {
        return this.delete(`controls;${shaderIndex}`);
    }
    getControlState(shaderIndex) {
        return this.get(`controls;${shaderIndex}`);
    }

    putFragmentSrc(idx, val) {
        return this.put(`${idx};fragmentSource`, val);
    }
    deleteFragmentSrc(shaderIndex) {
        return this.delete(`${shaderIndex};fragmentSource`);
    }
    getFragmentSrc(shaderIndex) {
        return this.get(`${shaderIndex};fragmentSource`);
    }
}
