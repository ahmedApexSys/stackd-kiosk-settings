/**
 * STACKD Kiosk Settings — Electron Main Process
 * Manages settings file I/O, API proxy calls, printer TCP checks,
 * device serial validation, and password-protected access.
 */
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');
const https = require('https');
const http = require('http');
const { execSync } = require('child_process');
const crypto = require('crypto');

// ─── Device Serial Number ───────────────────────────────────

function getMachineSerialNumber() {
  try {
    // Windows: get motherboard serial via WMIC
    const raw = execSync('wmic bios get serialnumber', { encoding: 'utf-8', timeout: 5000 });
    const lines = raw.trim().split('\n').map(l => l.trim()).filter(Boolean);
    // Second line is the actual serial (first is header "SerialNumber")
    const serial = lines.length > 1 ? lines[1] : null;
    if (serial && serial !== 'SerialNumber' && serial.length > 2) {
      console.log('[Serial] Machine serial:', serial);
      return serial;
    }
  } catch (e) {
    console.warn('[Serial] WMIC failed, trying PowerShell...');
  }
  try {
    const raw = execSync(
      'powershell -Command "(Get-WmiObject Win32_BIOS).SerialNumber"',
      { encoding: 'utf-8', timeout: 5000 }
    );
    const serial = raw.trim();
    if (serial && serial.length > 2) {
      console.log('[Serial] Machine serial (PS):', serial);
      return serial;
    }
  } catch (e2) {
    console.error('[Serial] Failed to get serial:', e2.message);
  }
  return null;
}

/** Generate same password hash as ControlPanel backend */
function generatePasswordHash(serialNo, companySettingId) {
  const raw = `${serialNo}:${companySettingId || 'APEX'}`;
  const hash = crypto.createHash('sha256').update(raw, 'utf-8').digest('hex');
  return hash.substring(0, 8).toUpperCase();
}

const MACHINE_SERIAL = getMachineSerialNumber();

// ─── Settings File ──────────────────────────────────────────
const SETTINGS_FILENAME = 'settings.json';

function getSettingsPath() {
  // 1. Same directory as executable (portable mode — writable folder)
  const exeDir = path.dirname(app.getPath('exe'));
  const portablePath = path.join(exeDir, SETTINGS_FILENAME);
  if (fs.existsSync(portablePath)) {
    try { fs.accessSync(path.dirname(portablePath), fs.constants.W_OK); return portablePath; } catch {}
  }

  // 2. App directory (development mode)
  const devPath = path.join(__dirname, '..', SETTINGS_FILENAME);
  if (fs.existsSync(devPath)) {
    try { fs.accessSync(path.dirname(devPath), fs.constants.W_OK); return devPath; } catch {}
  }

  // 3. userData folder (always writable — works in packaged/portable/asar modes)
  const userDataPath = path.join(app.getPath('userData'), SETTINGS_FILENAME);
  // Copy default settings from app bundle if first run
  if (!fs.existsSync(userDataPath)) {
    const bundledPath = path.join(__dirname, '..', SETTINGS_FILENAME);
    if (fs.existsSync(bundledPath)) {
      try { fs.copyFileSync(bundledPath, userDataPath); } catch {}
    }
  }
  return userDataPath;
}

// Also write to Kiosk app's directory if it exists nearby
function getKioskSettingsPath() {
  const exeDir = path.dirname(app.getPath('exe'));
  // Check common relative paths
  const candidates = [
    path.join(exeDir, '..', 'KioskApp', SETTINGS_FILENAME),
    path.join(exeDir, '..', 'STACKD Kiosk', SETTINGS_FILENAME),
    path.resolve('D:/Ramdan/KioskApp', SETTINGS_FILENAME),
  ];
  for (const p of candidates) {
    const dir = path.dirname(p);
    if (fs.existsSync(dir)) return p;
  }
  return null;
}

function loadSettings() {
  try {
    const settingsPath = getSettingsPath();
    if (fs.existsSync(settingsPath)) {
      const raw = fs.readFileSync(settingsPath, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.error('Failed to load settings:', err.message);
  }
  // Return defaults
  return {
    apiBaseUrl: 'https://kiosk.tryasp.net',
    apiKey: 'wL2b7ci41AFlxXL2E2BC4k8xLAc4sqbKk4/wJ8ZVXTs=',
    branchId: 1,
    menuId: 2,
    deviceCode: 'KIOSK-001',
    fawryBaseUrl: 'http://localhost:5050',
    receiptPrinterId: null,
    chequeDesignCode: 'CHEQUE_A',
    kitchenDesignCode: 'KITCHEN_A',
    serviceChargePercent: 12,
    taxPercent: 14,
    idleTimeoutMs: 120000,
    menuRefreshMs: 300000,
    defaultLocale: 'en',
  };
}

function saveSettings(settings) {
  try {
    const json = JSON.stringify(settings, null, 2);

    // Save to main settings path
    const mainPath = getSettingsPath();
    fs.writeFileSync(mainPath, json, 'utf-8');
    console.log('Settings saved to:', mainPath);

    // Also save to Kiosk app directory
    const kioskPath = getKioskSettingsPath();
    if (kioskPath) {
      fs.writeFileSync(kioskPath, json, 'utf-8');
      console.log('Settings also saved to Kiosk app:', kioskPath);
    }

    return { success: true, path: mainPath, kioskPath };
  } catch (err) {
    console.error('Failed to save settings:', err.message);
    return { success: false, error: err.message };
  }
}

// ─── HTTP Request Helper ────────────────────────────────────

function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === 'https:';
    const lib = isHttps ? https : http;

    const reqOptions = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: options.headers || {},
      timeout: options.timeout || 10000,
      rejectUnauthorized: false, // Allow self-signed certs
    };

    const req = lib.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            data: data ? JSON.parse(data) : null,
          });
        } catch {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

// ─── TCP Printer Check ──────────────────────────────────────

function checkPrinterTcp(ip, port = 9100, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = new net.Socket();

    socket.setTimeout(timeoutMs);

    socket.connect(port, ip, () => {
      const elapsed = Date.now() - start;
      socket.destroy();
      resolve({ isOnline: true, responseTimeMs: elapsed, error: null });
    });

    socket.on('error', (err) => {
      const elapsed = Date.now() - start;
      socket.destroy();
      resolve({ isOnline: false, responseTimeMs: elapsed, error: err.message });
    });

    socket.on('timeout', () => {
      const elapsed = Date.now() - start;
      socket.destroy();
      resolve({ isOnline: false, responseTimeMs: elapsed, error: 'Connection timeout' });
    });
  });
}

// ─── Print Test Receipt (ESC/POS) ───────────────────────────

function printTestReceipt(ip, port = 9100) {
  return new Promise((resolve, reject) => {
    const ESC = 0x1b;
    const GS = 0x1d;

    const commands = Buffer.from([
      ESC, 0x40,             // Initialize
      ESC, 0x61, 0x01,       // Center align
      ESC, 0x45, 0x01,       // Bold ON
      GS, 0x21, 0x11,        // Double width+height
      ...Buffer.from('STACKD KIOSK\n'),
      GS, 0x21, 0x00,        // Normal size
      ESC, 0x45, 0x00,       // Bold OFF
      ...Buffer.from('--------------------------------\n'),
      ...Buffer.from('Printer Test Receipt\n'),
      ...Buffer.from(`Date: ${new Date().toLocaleString()}\n`),
      ...Buffer.from('--------------------------------\n'),
      ...Buffer.from('Connection: OK\n'),
      ...Buffer.from(`IP: ${ip}:${port}\n`),
      ...Buffer.from('--------------------------------\n'),
      ESC, 0x45, 0x01,       // Bold ON
      ...Buffer.from('Printer is working correctly!\n'),
      ESC, 0x45, 0x00,       // Bold OFF
      ...Buffer.from('\n\n\n'),
      GS, 0x56, 0x00,        // Full cut
    ]);

    const socket = new net.Socket();
    socket.setTimeout(5000);

    socket.connect(port, ip, () => {
      socket.write(commands, () => {
        socket.destroy();
        resolve({ success: true });
      });
    });

    socket.on('error', (err) => {
      socket.destroy();
      reject(err);
    });

    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error('Print timeout'));
    });
  });
}

// ─── IPC Handlers ───────────────────────────────────────────

function setupIPC() {
  // Settings
  ipcMain.handle('load-settings', () => loadSettings());
  ipcMain.handle('save-settings', (_, settings) => saveSettings(settings));

  // API Proxy — GET
  ipcMain.handle('api-get', async (_, { url, apiKey }) => {
    try {
      const result = await makeRequest(url, {
        headers: {
          'X-Api-Key': apiKey,
          'Accept': 'application/json',
        },
      });
      return result;
    } catch (err) {
      return { status: 0, data: null, error: err.message };
    }
  });

  // API Proxy — POST
  ipcMain.handle('api-post', async (_, { url, apiKey, body }) => {
    try {
      const result = await makeRequest(url, {
        method: 'POST',
        headers: {
          'X-Api-Key': apiKey,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body,
      });
      return result;
    } catch (err) {
      return { status: 0, data: null, error: err.message };
    }
  });

  // TCP Printer check
  ipcMain.handle('check-printer', async (_, { ip, port }) => {
    return checkPrinterTcp(ip, port || 9100);
  });

  // Print test receipt
  ipcMain.handle('print-test', async (_, { ip, port }) => {
    try {
      return await printTestReceipt(ip, port || 9100);
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Open file dialog
  ipcMain.handle('select-file', async () => {
    const result = await dialog.showOpenDialog({
      filters: [{ name: 'JSON Files', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (!result.canceled && result.filePaths.length > 0) {
      const content = fs.readFileSync(result.filePaths[0], 'utf-8');
      return { path: result.filePaths[0], content };
    }
    return null;
  });

  // Export settings to file
  ipcMain.handle('export-settings', async (_, settings) => {
    const result = await dialog.showSaveDialog({
      defaultPath: 'kiosk-settings.json',
      filters: [{ name: 'JSON Files', extensions: ['json'] }],
    });
    if (!result.canceled && result.filePath) {
      fs.writeFileSync(result.filePath, JSON.stringify(settings, null, 2), 'utf-8');
      return { success: true, path: result.filePath };
    }
    return { success: false };
  });

  // Get machine serial number
  ipcMain.handle('get-serial', () => MACHINE_SERIAL);

  // Validate device against ControlPanel
  ipcMain.handle('validate-device', async (_, { controlPanelUrl, serialNo, branchId }) => {
    try {
      const url = `${controlPanelUrl}/api/Device/validate?serialNo=${encodeURIComponent(serialNo)}&branchId=${branchId}`;
      const result = await makeRequest(url, {
        headers: { 'Accept': 'application/json' },
        timeout: 10000,
      });
      return result;
    } catch (err) {
      return { status: 0, data: null, error: err.message };
    }
  });

  // Generate local password hash (for offline verification)
  ipcMain.handle('generate-password', (_, { serialNo, companySettingId }) => {
    return generatePasswordHash(serialNo, companySettingId);
  });
}

// ─── Window ─────────────────────────────────────────────────

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 900,
    minHeight: 600,
    title: 'STACKD Kiosk Settings',
    icon: path.join(__dirname, '..', 'src', 'img', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    autoHideMenuBar: true,
    backgroundColor: '#1a1a2e',
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'src', 'index.html'));

  // DevTools shortcut
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.control && input.shift && input.key === 'D') {
      mainWindow.webContents.toggleDevTools();
    }
  });
}

// ─── App Lifecycle ──────────────────────────────────────────

app.whenReady().then(() => {
  setupIPC();
  createWindow();
});

app.on('window-all-closed', () => app.quit());
