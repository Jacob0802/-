/* ============================================
   INVOY — IndexedDB Data Layer
   ============================================ */

const InvoyDB = (() => {
    const DB_NAME = 'invoy';
    const DB_VERSION = 1;
    let db = null;

    function open() {
        return new Promise((resolve, reject) => {
            if (db) { resolve(db); return; }
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = (e) => {
                const database = e.target.result;
                if (!database.objectStoreNames.contains('invoices')) {
                    const invStore = database.createObjectStore('invoices', { keyPath: 'id' });
                    invStore.createIndex('status', 'status', { unique: false });
                    invStore.createIndex('createdAt', 'createdAt', { unique: false });
                    invStore.createIndex('clientId', 'clientId', { unique: false });
                }
                if (!database.objectStoreNames.contains('clients')) {
                    const clientStore = database.createObjectStore('clients', { keyPath: 'id' });
                    clientStore.createIndex('name', 'name', { unique: false });
                }
                if (!database.objectStoreNames.contains('settings')) {
                    database.createObjectStore('settings', { keyPath: 'key' });
                }
            };

            request.onsuccess = (e) => {
                db = e.target.result;
                resolve(db);
            };

            request.onerror = (e) => reject(e.target.error);
        });
    }

    function tx(storeName, mode = 'readonly') {
        return db.transaction(storeName, mode).objectStore(storeName);
    }

    function promisify(request) {
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    // --- Generic CRUD ---
    async function getAll(storeName) {
        await open();
        return promisify(tx(storeName).getAll());
    }

    async function get(storeName, id) {
        await open();
        return promisify(tx(storeName).get(id));
    }

    async function put(storeName, data) {
        await open();
        return promisify(tx(storeName, 'readwrite').put(data));
    }

    async function remove(storeName, id) {
        await open();
        return promisify(tx(storeName, 'readwrite').delete(id));
    }

    // --- Invoice Methods ---
    async function getAllInvoices() {
        return getAll('invoices');
    }

    async function getInvoice(id) {
        return get('invoices', id);
    }

    async function saveInvoice(invoice) {
        invoice.updatedAt = new Date().toISOString();
        if (!invoice.createdAt) invoice.createdAt = invoice.updatedAt;
        return put('invoices', invoice);
    }

    async function deleteInvoice(id) {
        return remove('invoices', id);
    }

    // --- Client Methods ---
    async function getAllClients() {
        return getAll('clients');
    }

    async function getClient(id) {
        return get('clients', id);
    }

    async function saveClient(client) {
        client.updatedAt = new Date().toISOString();
        if (!client.createdAt) client.createdAt = client.updatedAt;
        return put('clients', client);
    }

    async function deleteClient(id) {
        return remove('clients', id);
    }

    // --- Settings Methods ---
    async function getSetting(key) {
        const result = await get('settings', key);
        return result ? result.value : null;
    }

    async function setSetting(key, value) {
        return put('settings', { key, value });
    }

    async function getSettings() {
        const all = await getAll('settings');
        const map = {};
        all.forEach(s => { map[s.key] = s.value; });
        return map;
    }

    // --- Backup / Restore ---
    async function exportAll() {
        const invoices = await getAllInvoices();
        const clients = await getAllClients();
        const settings = await getSettings();
        return { invoices, clients, settings, exportedAt: new Date().toISOString(), version: DB_VERSION };
    }

    async function importAll(data) {
        await open();
        if (data.invoices) {
            for (const inv of data.invoices) {
                await put('invoices', inv);
            }
        }
        if (data.clients) {
            for (const client of data.clients) {
                await put('clients', client);
            }
        }
        if (data.settings) {
            for (const [key, value] of Object.entries(data.settings)) {
                await setSetting(key, value);
            }
        }
    }

    return {
        open,
        getAllInvoices, getInvoice, saveInvoice, deleteInvoice,
        getAllClients, getClient, saveClient, deleteClient,
        getSetting, setSetting, getSettings,
        exportAll, importAll
    };
})();
