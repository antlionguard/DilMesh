import Store from 'electron-store'
import { ipcMain } from 'electron'

const store = new Store()

export function setupStoreHandlers() {
    ipcMain.handle('get-settings', (_, key) => {
        return store.get(key)
    })

    ipcMain.handle('set-settings', (_, key, value) => {
        store.set(key, value)
    })

    ipcMain.handle('save-project-state', (_, windows) => {
        store.set('project-state', windows)
    })

    ipcMain.handle('get-project-state', () => {
        return store.get('project-state')
    })
}

export { store }
