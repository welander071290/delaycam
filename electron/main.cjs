const { app, BrowserWindow, ipcMain, session } = require('electron')
const path = require('node:path')

const developmentUrl = process.env.DELAYCAM_DEV_SERVER_URL

function isTrustedOrigin(webContents, origin = '') {
  const currentUrl = webContents?.getURL() ?? origin
  return (
    currentUrl.startsWith('file://') ||
    currentUrl.startsWith('http://localhost:') ||
    currentUrl.startsWith('http://127.0.0.1:')
  )
}

function configureCameraPermissions() {
  const defaultSession = session.defaultSession

  defaultSession.setPermissionCheckHandler(
    (webContents, permission, requestingOrigin) =>
      permission === 'media' && isTrustedOrigin(webContents, requestingOrigin),
  )

  defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permission === 'media' && isTrustedOrigin(webContents))
  })
}

ipcMain.on('close-window', (event) => {
  if (!isTrustedOrigin(event.sender)) {
    return
  }

  BrowserWindow.fromWebContents(event.sender)?.close()
})

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: '#0c100e',
    autoHideMenuBar: true,
    fullscreen: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  mainWindow.removeMenu()
  mainWindow.once('ready-to-show', () => mainWindow.show())

  if (developmentUrl) {
    void mainWindow.loadURL(developmentUrl)
  } else {
    void mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
}

app.whenReady().then(() => {
  configureCameraPermissions()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})