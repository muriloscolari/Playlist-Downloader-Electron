const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');
const QueueManager = require('./queue-manager');

let mainWindow;
let queueManager;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1000,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false // Required for some node functionality if not careful, but we use preload
        },
        backgroundColor: '#121212',
        show: false
    });

    mainWindow.loadFile(path.join(__dirname, 'index.html'));

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    // mainWindow.webContents.openDevTools(); // For debugging
}

app.whenReady().then(() => {
    createWindow();

    // Initialize Queue Manager
    queueManager = new QueueManager(mainWindow);

    // --- IPC Handlers (must be after queueManager is initialized) ---
    ipcMain.handle('add-to-queue', async (event, url) => {
        return queueManager.addToQueue(url);
    });

    ipcMain.handle('start-queue', async () => {
        queueManager.start();
        return { success: true };
    });

    ipcMain.handle('open-downloads-folder', () => {
        const downloadPath = path.join(process.cwd(), 'downloads');
        if (!fs.existsSync(downloadPath)) {
            fs.mkdirSync(downloadPath);
        }
        shell.openPath(downloadPath);
    });

    app.on('activate', function () {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') app.quit();
});
