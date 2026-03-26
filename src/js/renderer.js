/**
 * STACKD Kiosk Settings — Renderer (UI Logic)
 * Manages login, tabs, form state, API calls, and printer operations.
 */

// ════════════════════════════════════════════════════════════
// Global State
// ════════════════════════════════════════════════════════════

const State = {
  settings: {},
  printers: [],
  printerStatus: {},   // printerId → { isOnline, responseTimeMs }
  designs: [],
  menuData: null,       // full menu with item printers
  dirty: false,
  machineSerial: null,  // auto-detected BIOS serial
  validationData: null, // response from ControlPanel /validate
};

// ════════════════════════════════════════════════════════════
// Tab Navigation
// ════════════════════════════════════════════════════════════

document.querySelectorAll('.nav-item[data-tab]').forEach((btn) => {
  btn.addEventListener('click', () => {
    // Update nav
    document.querySelectorAll('.nav-item').forEach((n) => n.classList.remove('active'));
    btn.classList.add('active');

    // Update panels
    const tabId = btn.dataset.tab;
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    document.getElementById('tab-' + tabId).classList.add('active');

    // Auto-load data for certain tabs
    if (tabId === 'printers' && State.printers.length === 0) {
      App.fetchPrinters();
    }
    if (tabId === 'designs' && State.designs.length === 0) {
      App.fetchDesigns();
    }
  });
});

// ════════════════════════════════════════════════════════════
// Toast Notifications
// ════════════════════════════════════════════════════════════

function showToast(message, type = 'info', durationMs = 3000) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = 'toast show ' + type;
  setTimeout(() => {
    toast.classList.remove('show');
  }, durationMs);
}

function flashSaveMsg() {
  const el = document.getElementById('saveMsg');
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 3000);
}

// ════════════════════════════════════════════════════════════
// Settings ↔ Form Binding
// ════════════════════════════════════════════════════════════

function settingsToForm(s) {
  setVal('controlPanelUrl', s.controlPanelUrl || 'https://apex-control-panel.tryasp.net');
  setVal('apiBaseUrl', s.apiBaseUrl || '');
  setVal('apiKey', s.apiKey || '');
  setVal('branchId', s.branchId || '');
  setVal('menuId', s.menuId || '');
  setVal('deviceCode', s.deviceCode || '');
  setVal('fawryBaseUrl', s.fawryBaseUrl || '');
  setVal('receiptPrinterId', s.receiptPrinterId || '');
  setVal('serviceChargePercent', s.serviceChargePercent ?? 12);
  setVal('taxPercent', s.taxPercent ?? 14);
  setVal('idleTimeoutSec', Math.round((s.idleTimeoutMs || 120000) / 1000));
  setVal('menuRefreshSec', Math.round((s.menuRefreshMs || 300000) / 1000));
  setVal('defaultLocale', s.defaultLocale || 'en');

  // Read-only fields
  setVal('deviceSerial', s.deviceSerialNo || State.machineSerial || 'Unknown');
  setVal('licenseExpiry', s.licenseExpiry ? new Date(s.licenseExpiry).toLocaleDateString() : 'N/A');
}

function formToSettings() {
  return {
    controlPanelUrl: getVal('controlPanelUrl').replace(/\/+$/, '') || 'https://apex-control-panel.tryasp.net',
    apiBaseUrl: getVal('apiBaseUrl').replace(/\/+$/, ''),
    apiKey: getVal('apiKey'),
    branchId: parseInt(getVal('branchId')) || 1,
    menuId: parseInt(getVal('menuId')) || 2,
    deviceCode: getVal('deviceCode') || 'KIOSK-001',
    fawryBaseUrl: getVal('fawryBaseUrl').replace(/\/+$/, ''),
    receiptPrinterId: parseInt(getVal('receiptPrinterId')) || null,
    chequeDesignCode: State.settings.chequeDesignCode || 'CHEQUE_A',
    kitchenDesignCode: State.settings.kitchenDesignCode || 'KITCHEN_A',
    serviceChargePercent: parseFloat(getVal('serviceChargePercent')) || 12,
    taxPercent: parseFloat(getVal('taxPercent')) || 14,
    idleTimeoutMs: (parseInt(getVal('idleTimeoutSec')) || 120) * 1000,
    menuRefreshMs: (parseInt(getVal('menuRefreshSec')) || 300) * 1000,
    defaultLocale: getVal('defaultLocale') || 'en',
    // Persisted validation data
    deviceValidated: State.settings.deviceValidated || false,
    deviceSerialNo: State.machineSerial || State.settings.deviceSerialNo || null,
    licenseExpiry: State.settings.licenseExpiry || null,
  };
}

function setVal(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val;
}

function getVal(id) {
  const el = document.getElementById(id);
  return el ? el.value.trim() : '';
}

// ════════════════════════════════════════════════════════════
// API Helpers
// ════════════════════════════════════════════════════════════

function apiUrl(path) {
  const base = getVal('apiBaseUrl') || State.settings.apiBaseUrl;
  return base.replace(/\/+$/, '') + path;
}

function apiKey() {
  return getVal('apiKey') || State.settings.apiKey;
}

async function apiGet(path) {
  return window.settingsAPI.apiGet(apiUrl(path), apiKey());
}

async function apiPost(path, body) {
  return window.settingsAPI.apiPost(apiUrl(path), apiKey(), body);
}

// ════════════════════════════════════════════════════════════
// Login / Device Validation
// ════════════════════════════════════════════════════════════

function showLoginError(msg) {
  const el = document.getElementById('loginError');
  el.textContent = msg;
  el.style.display = 'block';
}

function hideLoginError() {
  const el = document.getElementById('loginError');
  el.textContent = '';
  el.style.display = 'none';
}

function showLoginLicense(data) {
  const el = document.getElementById('loginLicenseInfo');
  if (!data) { el.style.display = 'none'; return; }

  const lines = [];
  if (data.deviceName) lines.push(`Device: ${data.deviceName}`);
  if (data.companyName) lines.push(`Company: ${data.companyName}`);
  if (data.branchName) lines.push(`Branch: ${data.branchName}`);
  if (data.expiryDate) {
    const exp = new Date(data.expiryDate).toLocaleDateString();
    lines.push(`Expires: ${exp} (${data.daysRemaining} days)`);
  }

  el.innerHTML = lines.map(l => `<div>${l}</div>`).join('');
  el.style.display = 'block';
}

function updateLicenseBadge(data) {
  const badge = document.getElementById('licenseStatus');
  const text = document.getElementById('licenseText');

  if (!data || !data.valid) {
    badge.style.display = 'none';
    return;
  }

  badge.style.display = 'flex';
  const remaining = data.daysRemaining || 0;

  if (remaining > 30) {
    text.textContent = `Licensed (${remaining}d)`;
    badge.querySelector('.status-dot').className = 'status-dot online';
  } else if (remaining > 0) {
    text.textContent = `Expiring (${remaining}d)`;
    badge.querySelector('.status-dot').className = 'status-dot warning';
  } else {
    text.textContent = 'License expired';
    badge.querySelector('.status-dot').className = 'status-dot offline';
  }
}

// ════════════════════════════════════════════════════════════
// App Actions
// ════════════════════════════════════════════════════════════

const App = {

  // ─── Login ──────────────────────────────────────────────
  async login() {
    hideLoginError();

    const controlPanelUrl = getVal('loginControlPanelUrl').replace(/\/+$/, '');
    const branchId = parseInt(getVal('loginBranchId')) || 1;
    const serialNo = getVal('loginSerial');
    const password = getVal('loginPassword');

    if (!serialNo || serialNo === 'Detecting...' || serialNo === 'Unknown') {
      showLoginError('Device serial number could not be detected. Cannot validate.');
      return;
    }

    if (!password) {
      showLoginError('Please enter the device password.');
      return;
    }

    if (!controlPanelUrl) {
      showLoginError('Please enter the Control Panel URL.');
      return;
    }

    // Show loading state
    const loginBtn = document.querySelector('.login-btn');
    const origText = loginBtn.innerHTML;
    loginBtn.innerHTML = '<span class="spinner"></span> Validating...';
    loginBtn.disabled = true;

    try {
      // Call ControlPanel validate endpoint
      const result = await window.settingsAPI.validateDevice(controlPanelUrl, serialNo, branchId);

      if (result.error) {
        showLoginError('Cannot reach Control Panel: ' + result.error);
        loginBtn.innerHTML = origText;
        loginBtn.disabled = false;
        return;
      }

      if (result.status !== 200 || !result.data) {
        showLoginError('Control Panel returned HTTP ' + result.status + '. Check URL and Branch ID.');
        loginBtn.innerHTML = origText;
        loginBtn.disabled = false;
        return;
      }

      const data = result.data;
      State.validationData = data;

      // Show device info even if invalid
      showLoginLicense(data);

      if (!data.valid) {
        showLoginError(data.message || 'Device validation failed.');
        loginBtn.innerHTML = origText;
        loginBtn.disabled = false;
        return;
      }

      // Verify password: compare entered password with server's passwordHash
      const enteredUpper = password.toUpperCase();
      const serverHash = (data.passwordHash || '').toUpperCase();

      if (enteredUpper !== serverHash) {
        showLoginError('Incorrect password. Contact your administrator.');
        loginBtn.innerHTML = origText;
        loginBtn.disabled = false;
        return;
      }

      // ─── Success! Unlock settings ───
      State.settings.deviceValidated = true;
      State.settings.deviceSerialNo = serialNo;
      State.settings.controlPanelUrl = controlPanelUrl;
      State.settings.licenseExpiry = data.expiryDate || null;

      // Update license badge in sidebar
      updateLicenseBadge(data);

      // Hide login overlay, show app
      document.getElementById('loginOverlay').style.display = 'none';
      document.getElementById('appContainer').style.display = '';

      // Initialize the settings form
      App.init();

      showToast('Device validated. Welcome!', 'success');

    } catch (err) {
      showLoginError('Validation error: ' + (err.message || err));
      loginBtn.innerHTML = origText;
      loginBtn.disabled = false;
    }
  },

  // ─── Initialize (after login) ─────────────────────────────
  async init() {
    try {
      State.settings = await window.settingsAPI.loadSettings();

      // Merge in runtime validation data
      if (State.validationData) {
        State.settings.deviceValidated = true;
        State.settings.deviceSerialNo = State.machineSerial;
        State.settings.controlPanelUrl = State.settings.controlPanelUrl ||
          getVal('loginControlPanelUrl') || 'https://apex-control-panel.tryasp.net';
        State.settings.licenseExpiry = State.validationData.expiryDate || null;
      }

      settingsToForm(State.settings);
      showToast('Settings loaded', 'info', 2000);

      // Auto-test connection
      setTimeout(() => App.testConnection(true), 500);
    } catch (err) {
      console.error('Init error:', err);
      showToast('Failed to load settings: ' + err.message, 'error');
    }
  },

  // ─── Test Connection ────────────────────────────────────
  async testConnection(quiet = false) {
    const el = document.getElementById('connectionResult');
    const dot = document.getElementById('apiStatusDot');
    const statusText = document.getElementById('apiStatusText');

    el.innerHTML = '<span class="spinner"></span>';

    try {
      const result = await apiGet('/health');

      if (result.status >= 200 && result.status < 300) {
        el.innerHTML = '<span class="text-green">&#10003; Connected (HTTP ' + result.status + ')</span>';
        dot.className = 'status-dot online';
        statusText.textContent = 'API Connected';
        if (!quiet) showToast('API connection successful!', 'success');
      } else {
        el.innerHTML = '<span class="text-red">&#10007; HTTP ' + result.status + '</span>';
        dot.className = 'status-dot offline';
        statusText.textContent = 'Connection failed';
        if (!quiet) showToast('API returned HTTP ' + result.status, 'error');
      }
    } catch (err) {
      el.innerHTML = '<span class="text-red">&#10007; ' + (err.message || 'Failed') + '</span>';
      dot.className = 'status-dot offline';
      statusText.textContent = 'Offline';
      if (!quiet) showToast('Connection failed: ' + err.message, 'error');
    }
  },

  // ─── Test Fawry ─────────────────────────────────────────
  async testFawry() {
    const el = document.getElementById('fawryResult');
    el.innerHTML = '<span class="spinner"></span>';

    try {
      const fawryUrl = getVal('fawryBaseUrl') || 'http://localhost:5050';
      const result = await window.settingsAPI.apiGet(fawryUrl + '/api/fawry/health', '');

      if (result.status >= 200 && result.status < 300) {
        el.innerHTML = '<span class="text-green">&#10003; Fawry service is running</span>';
        showToast('Fawry health check passed!', 'success');
      } else {
        el.innerHTML = '<span class="text-yellow">&#9888; HTTP ' + result.status + '</span>';
      }
    } catch (err) {
      el.innerHTML = '<span class="text-red">&#10007; Not reachable</span>';
      showToast('Fawry service not available', 'error');
    }
  },

  // ─── Fetch Devices ──────────────────────────────────────
  async fetchDevices() {
    const branchId = getVal('branchId');
    const card = document.getElementById('devicesCard');
    const list = document.getElementById('devicesList');

    card.style.display = 'block';
    list.innerHTML = '<div class="loading-overlay"><div class="spinner"></div> Loading devices...</div>';

    try {
      const result = await apiGet('/api/devices?branchId=' + branchId);
      const devices = result.data?.data || result.data || [];

      if (!Array.isArray(devices) || devices.length === 0) {
        list.innerHTML = '<div class="empty-state"><p>No devices found for Branch ' + branchId + '</p></div>';
        return;
      }

      list.innerHTML = '<table class="data-table"><thead><tr>' +
        '<th>Code</th><th>Name</th><th>Active</th><th>Receipt Printer</th><th>Cheque Design</th><th>Kitchen Design</th><th></th>' +
        '</tr></thead><tbody>' +
        devices.map(d => `<tr>
          <td class="mono bold">${d.deviceCode}</td>
          <td>${d.name || '-'}</td>
          <td>${d.isActive ? '<span class="text-green">Active</span>' : '<span class="text-red">Inactive</span>'}</td>
          <td>${d.receiptPrinterName || '-'} ${d.receiptPrinterIp ? '(' + d.receiptPrinterIp + ')' : ''}</td>
          <td class="mono">${d.chequeDesignCode || '-'}</td>
          <td class="mono">${d.kitchenDesignCode || '-'}</td>
          <td><button class="btn btn-outline btn-sm" onclick="App.useDevice('${d.deviceCode}', ${d.receiptPrinterId || 'null'}, '${d.chequeDesignCode || ''}', '${d.kitchenDesignCode || ''}')">Use</button></td>
        </tr>`).join('') +
        '</tbody></table>';

      showToast(devices.length + ' device(s) loaded', 'success');
    } catch (err) {
      list.innerHTML = '<div class="empty-state text-red"><p>Error: ' + err.message + '</p></div>';
    }
  },

  useDevice(code, receiptPrinterId, chequeDesign, kitchenDesign) {
    setVal('deviceCode', code);
    if (receiptPrinterId) setVal('receiptPrinterId', receiptPrinterId);
    if (chequeDesign) State.settings.chequeDesignCode = chequeDesign;
    if (kitchenDesign) State.settings.kitchenDesignCode = kitchenDesign;
    showToast('Device ' + code + ' applied', 'success');
  },

  // ─── Verify Menu ────────────────────────────────────────
  async verifyMenu() {
    const menuId = getVal('menuId');
    const branchId = getVal('branchId');
    const card = document.getElementById('menuVerifyCard');
    const info = document.getElementById('menuInfo');

    card.style.display = 'block';
    info.innerHTML = '<div class="loading-overlay"><div class="spinner"></div> Verifying menu...</div>';

    try {
      const result = await apiGet(`/api/Menu/GetSelectedMenu?MenuId=${menuId}&BranchId=${branchId}`);
      const data = result.data?.data || result.data;

      if (!data || !data.menuIsActive) {
        info.innerHTML = `<div class="text-red">&#10007; Menu not active or not found</div>
          <pre class="text-sm text-muted mt-8">${JSON.stringify(result.data, null, 2)}</pre>`;
        return;
      }

      const cats = data.categories || [];
      const totalItems = cats.reduce((sum, c) => sum + (c.items?.length || 0), 0);

      info.innerHTML = `
        <div class="text-green mb-8">&#10003; Menu is active</div>
        <table class="data-table">
          <tr><td class="bold" style="width:150px">Menu ID</td><td>${data.selectedMenuId}</td></tr>
          <tr><td class="bold">Name (EN)</td><td>${data.selectedMenuNameEn || '-'}</td></tr>
          <tr><td class="bold">Name (AR)</td><td>${data.selectedMenuNameAr || '-'}</td></tr>
          <tr><td class="bold">Categories</td><td>${cats.length}</td></tr>
          <tr><td class="bold">Total Items</td><td>${totalItems}</td></tr>
        </table>
      `;

      showToast('Menu verified: ' + cats.length + ' categories, ' + totalItems + ' items', 'success');
    } catch (err) {
      info.innerHTML = '<div class="text-red">Error: ' + err.message + '</div>';
    }
  },

  // ─── Fetch Printers ─────────────────────────────────────
  async fetchPrinters() {
    const branchId = getVal('branchId');
    const container = document.getElementById('printersLoading');
    const list = document.getElementById('printersList');

    container.style.display = 'flex';
    list.innerHTML = '';

    try {
      const result = await apiGet('/api/printers?branchId=' + branchId);
      const printers = result.data?.data || result.data || [];

      container.style.display = 'none';

      if (!Array.isArray(printers) || printers.length === 0) {
        list.innerHTML = '<div class="empty-state"><div class="icon">&#128424;</div><p>No printers found for Branch ' + branchId + '</p></div>';
        return;
      }

      State.printers = printers;
      renderPrinters();
      updatePrinterSelect();

      showToast(printers.length + ' printer(s) loaded', 'success');
    } catch (err) {
      container.style.display = 'none';
      list.innerHTML = '<div class="empty-state text-red"><p>Error: ' + err.message + '</p></div>';
    }
  },

  // ─── Check All Printers ─────────────────────────────────
  async checkAllPrinters() {
    if (State.printers.length === 0) {
      showToast('Load printers first', 'info');
      return;
    }

    showToast('Checking printers...', 'info', 1500);

    for (const p of State.printers) {
      if (p.ipAddress) {
        try {
          const result = await window.settingsAPI.checkPrinter(p.ipAddress, p.port || 9100);
          State.printerStatus[p.id] = result;
        } catch {
          State.printerStatus[p.id] = { isOnline: false, error: 'Check failed' };
        }
      }
    }

    renderPrinters();

    const online = Object.values(State.printerStatus).filter(s => s.isOnline).length;
    showToast(`${online}/${State.printers.length} printers online`, online > 0 ? 'success' : 'error');
  },

  // ─── Check Single Printer ──────────────────────────────
  async checkPrinter(id, ip, port) {
    const btn = document.querySelector(`[data-check="${id}"]`);
    if (btn) btn.innerHTML = '<span class="spinner"></span>';

    try {
      const result = await window.settingsAPI.checkPrinter(ip, port || 9100);
      State.printerStatus[id] = result;
      renderPrinters();

      if (result.isOnline) {
        showToast(`Printer ${ip} is online (${result.responseTimeMs}ms)`, 'success');
      } else {
        showToast(`Printer ${ip} is offline: ${result.error}`, 'error');
      }
    } catch (err) {
      State.printerStatus[id] = { isOnline: false, error: err.message };
      renderPrinters();
    }
  },

  // ─── Print Test Receipt ─────────────────────────────────
  async printTest(ip, port) {
    showToast('Sending test receipt to ' + ip + '...', 'info');
    try {
      const result = await window.settingsAPI.printTest(ip, port || 9100);
      if (result.success) {
        showToast('Test receipt sent to ' + ip, 'success');
      } else {
        showToast('Print failed: ' + (result.error || 'Unknown error'), 'error');
      }
    } catch (err) {
      showToast('Print error: ' + err.message, 'error');
    }
  },

  // ─── Fetch Designs ──────────────────────────────────────
  async fetchDesigns() {
    const chequeContainer = document.getElementById('chequeDesigns');
    const kitchenContainer = document.getElementById('kitchenDesigns');

    chequeContainer.innerHTML = '<div class="loading-overlay"><div class="spinner"></div></div>';
    kitchenContainer.innerHTML = '<div class="loading-overlay"><div class="spinner"></div></div>';

    try {
      const result = await apiGet('/api/designs');
      const designs = result.data?.data || result.data || [];

      if (Array.isArray(designs) && designs.length > 0) {
        State.designs = designs;
      } else {
        // Use built-in defaults
        State.designs = getDefaultDesigns();
      }

      renderDesigns();
    } catch {
      // Use built-in defaults on error
      State.designs = getDefaultDesigns();
      renderDesigns();
    }
  },

  selectDesign(type, code) {
    if (type === 'cheque') {
      State.settings.chequeDesignCode = code;
    } else {
      State.settings.kitchenDesignCode = code;
    }
    renderDesigns();
    showToast('Selected ' + code, 'success', 1500);
  },

  // ─── Fetch Item Printers ────────────────────────────────
  async fetchItemPrinters() {
    const container = document.getElementById('itemPrintersList');
    const empty = document.getElementById('itemPrintersEmpty');
    const menuId = getVal('menuId');
    const branchId = getVal('branchId');

    empty.style.display = 'none';
    container.innerHTML = '<div class="loading-overlay"><div class="spinner"></div> Loading full menu with printers...</div>';

    try {
      const result = await apiGet(`/api/Menu/GetSelectedMenu?MenuId=${menuId}&BranchId=${branchId}`);
      const data = result.data?.data || result.data;

      if (!data || !data.categories) {
        container.innerHTML = '<div class="empty-state text-red"><p>Could not load menu data</p></div>';
        return;
      }

      State.menuData = data;
      renderItemPrinters(data);
      showToast('Menu loaded with printer assignments', 'success');
    } catch (err) {
      container.innerHTML = '<div class="empty-state text-red"><p>Error: ' + err.message + '</p></div>';
    }
  },

  // ─── Save All ───────────────────────────────────────────
  async saveAll() {
    const settings = formToSettings();
    State.settings = settings;

    try {
      const result = await window.settingsAPI.saveSettings(settings);
      if (result.success) {
        flashSaveMsg();
        showToast('Settings saved to ' + result.path, 'success');
        if (result.kioskPath) {
          showToast('Also saved to Kiosk app', 'info', 2000);
        }
      } else {
        showToast('Save failed: ' + result.error, 'error');
      }
    } catch (err) {
      showToast('Save error: ' + err.message, 'error');
    }
  },

  // ─── Reset Defaults ─────────────────────────────────────
  resetDefaults() {
    const defaults = {
      controlPanelUrl: 'https://apex-control-panel.tryasp.net',
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
    State.settings = defaults;
    settingsToForm(defaults);
    showToast('Defaults restored (not saved yet)', 'info');
  },

  // ─── Import / Export ────────────────────────────────────
  async importSettings() {
    try {
      const result = await window.settingsAPI.importSettings();
      if (result && result.content) {
        const imported = JSON.parse(result.content);
        State.settings = imported;
        settingsToForm(imported);
        showToast('Settings imported from ' + result.path, 'success');
      }
    } catch (err) {
      showToast('Import error: ' + err.message, 'error');
    }
  },

  async exportSettings() {
    const settings = formToSettings();
    try {
      const result = await window.settingsAPI.exportSettings(settings);
      if (result.success) {
        showToast('Exported to ' + result.path, 'success');
      }
    } catch (err) {
      showToast('Export error: ' + err.message, 'error');
    }
  },
};

// ════════════════════════════════════════════════════════════
// Render Functions
// ════════════════════════════════════════════════════════════

function renderPrinters() {
  const list = document.getElementById('printersList');
  const currentReceipt = parseInt(getVal('receiptPrinterId'));

  list.innerHTML = State.printers.map(p => {
    const status = State.printerStatus[p.id];
    const isReceipt = p.id === currentReceipt;
    const statusClass = status ? (status.isOnline ? 'online' : 'offline') : '';
    const statusLabel = status
      ? (status.isOnline ? `Online (${status.responseTimeMs}ms)` : `Offline`)
      : 'Unknown';

    return `
      <div class="printer-row${isReceipt ? ' selected' : ''}">
        <div class="printer-icon">${isReceipt ? '&#129534;' : '&#128424;'}</div>
        <div class="printer-info">
          <div class="printer-name">${p.printerName}${isReceipt ? ' <span class="text-green text-sm">(Receipt)</span>' : ''}</div>
          <div class="printer-detail">
            IP: <span class="mono">${p.ipAddress || 'N/A'}:${p.port || 9100}</span>
            &nbsp;|&nbsp; Type: ${p.printerType || 'N/A'}
            ${p.isInMaintenance ? '&nbsp;|&nbsp; <span class="text-yellow">Maintenance</span>' : ''}
          </div>
        </div>
        <div class="printer-actions">
          ${status ? `<span class="status-pill ${statusClass}"><span class="dot"></span> ${statusLabel}</span>` : ''}
          ${p.ipAddress ? `
            <button class="btn btn-outline btn-sm" data-check="${p.id}" onclick="App.checkPrinter(${p.id}, '${p.ipAddress}', ${p.port || 9100})">
              &#128268; Check
            </button>
            <button class="btn btn-outline btn-sm" onclick="App.printTest('${p.ipAddress}', ${p.port || 9100})">
              &#128424; Test Print
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function updatePrinterSelect() {
  const select = document.getElementById('receiptPrinterId');
  const current = State.settings.receiptPrinterId;

  select.innerHTML = '<option value="">-- Select receipt printer --</option>' +
    State.printers.map(p =>
      `<option value="${p.id}" ${p.id === current ? 'selected' : ''}>
        ${p.printerName} (${p.ipAddress || 'N/A'}:${p.port || 9100})
      </option>`
    ).join('');
}

function renderDesigns() {
  const cheques = State.designs.filter(d => d.designType === 'Cheque');
  const kitchens = State.designs.filter(d => d.designType === 'KitchenSlip');
  const selectedCheque = State.settings.chequeDesignCode || 'CHEQUE_A';
  const selectedKitchen = State.settings.kitchenDesignCode || 'KITCHEN_A';

  document.getElementById('chequeDesigns').innerHTML = cheques.map(d => `
    <div class="design-card${d.designCode === selectedCheque ? ' selected' : ''}"
         onclick="App.selectDesign('cheque', '${d.designCode}')">
      <div class="design-card-code">${d.designCode}</div>
      <div class="design-card-name">${d.name}</div>
      <div class="design-card-desc">${d.description || ''}</div>
    </div>
  `).join('');

  document.getElementById('kitchenDesigns').innerHTML = kitchens.map(d => `
    <div class="design-card${d.designCode === selectedKitchen ? ' selected' : ''}"
         onclick="App.selectDesign('kitchen', '${d.designCode}')">
      <div class="design-card-code">${d.designCode}</div>
      <div class="design-card-name">${d.name}</div>
      <div class="design-card-desc">${d.description || ''}</div>
    </div>
  `).join('');
}

function renderItemPrinters(menu) {
  const container = document.getElementById('itemPrintersList');
  const categories = menu.categories || [];

  if (categories.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>No categories found in menu</p></div>';
    return;
  }

  container.innerHTML = categories.map(cat => {
    const items = cat.items || [];
    return `
      <div class="category-header" onclick="this.nextElementSibling.classList.toggle('hidden')">
        <div>
          <span class="category-name">${cat.nameEn || cat.categoryNameEn || ''}</span>
          <span class="text-muted text-sm"> (${cat.nameAr || cat.categoryNameAr || ''})</span>
        </div>
        <span class="category-count">${items.length} items</span>
      </div>
      <div class="category-items">
        ${items.map(item => {
          const printers = item.kitchenPrinters || [];
          return `
            <div class="item-row">
              <div class="item-name">${item.nameEn || item.itemNameEn || ''}</div>
              <div class="item-printers-list">
                ${printers.length > 0
                  ? printers.map(p => {
                      const pName = (p.printerName || '').toLowerCase();
                      let tagClass = '';
                      if (pName.includes('kitchen') || pName.includes('مطبخ')) tagClass = 'kitchen';
                      else if (pName.includes('bar') || pName.includes('بار')) tagClass = 'bar';
                      else if (pName.includes('shisha') || pName.includes('شيشة')) tagClass = 'shisha';
                      return `<span class="printer-tag ${tagClass}">${p.printerName} (${p.ipAddress || '?'})</span>`;
                    }).join('')
                  : '<span class="text-muted text-sm">No printer assigned</span>'
                }
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }).join('');
}

// ════════════════════════════════════════════════════════════
// Default Designs (fallback when API not available)
// ════════════════════════════════════════════════════════════

function getDefaultDesigns() {
  return [
    { designCode: 'CHEQUE_A', designType: 'Cheque', name: 'Compact Table', description: 'Default compact receipt with table layout' },
    { designCode: 'CHEQUE_B', designType: 'Cheque', name: 'Spacious Big Items', description: 'Large item names with generous spacing' },
    { designCode: 'CHEQUE_C', designType: 'Cheque', name: 'Two-Line Items', description: 'Item details on two lines' },
    { designCode: 'CHEQUE_D', designType: 'Cheque', name: 'Centered Modern', description: 'Modern centered layout' },
    { designCode: 'CHEQUE_E', designType: 'Cheque', name: 'Bold Sections Box', description: 'Bold section headers with boxes' },
    { designCode: 'CHEQUE_F', designType: 'Cheque', name: 'Large Order Number', description: 'Prominent order number display' },
    { designCode: 'CHEQUE_G', designType: 'Cheque', name: 'Dotted Lines', description: 'Dotted line separators' },
    { designCode: 'CHEQUE_H', designType: 'Cheque', name: 'Minimal Clean', description: 'Clean minimal design' },
    { designCode: 'CHEQUE_I', designType: 'Cheque', name: 'Wide Item Names', description: 'Full-width item names' },
    { designCode: 'CHEQUE_J', designType: 'Cheque', name: 'Order Number Focus', description: 'Order number as main focus' },
    { designCode: 'KITCHEN_A', designType: 'KitchenSlip', name: 'Standard', description: 'Standard kitchen slip' },
    { designCode: 'KITCHEN_B', designType: 'KitchenSlip', name: 'Urgent Big Bold', description: 'Large bold items for busy kitchens' },
    { designCode: 'KITCHEN_C', designType: 'KitchenSlip', name: 'Numbered List', description: 'Numbered item list' },
    { designCode: 'KITCHEN_D', designType: 'KitchenSlip', name: 'Separator Lines', description: 'Clear line separators' },
    { designCode: 'KITCHEN_E', designType: 'KitchenSlip', name: 'Compact Readable', description: 'Compact but readable' },
    { designCode: 'KITCHEN_F', designType: 'KitchenSlip', name: 'Checkboxes', description: 'With preparation checkboxes' },
    { designCode: 'KITCHEN_G', designType: 'KitchenSlip', name: 'Category Headers', description: 'Items grouped by category' },
    { designCode: 'KITCHEN_H', designType: 'KitchenSlip', name: 'Rush Priority', description: 'Rush/priority order format' },
    { designCode: 'KITCHEN_I', designType: 'KitchenSlip', name: 'Grid Style', description: 'Grid-style layout' },
    { designCode: 'KITCHEN_J', designType: 'KitchenSlip', name: 'Ticket Stub', description: 'Ticket stub format' },
  ];
}

// ════════════════════════════════════════════════════════════
// Boot — Show Login Overlay, Detect Serial
// ════════════════════════════════════════════════════════════

window.addEventListener('DOMContentLoaded', async () => {
  // Detect machine serial number
  try {
    const serial = await window.settingsAPI.getSerial();
    State.machineSerial = serial;
    const loginSerialEl = document.getElementById('loginSerial');
    if (loginSerialEl) {
      loginSerialEl.value = serial || 'Unknown';
    }
  } catch (err) {
    console.error('Failed to get serial:', err);
    const loginSerialEl = document.getElementById('loginSerial');
    if (loginSerialEl) loginSerialEl.value = 'Detection failed';
  }

  // Pre-fill login form from saved settings
  try {
    const saved = await window.settingsAPI.loadSettings();
    if (saved.controlPanelUrl) {
      setVal('loginControlPanelUrl', saved.controlPanelUrl);
    }
    if (saved.branchId) {
      setVal('loginBranchId', saved.branchId);
    }
  } catch (e) {
    // Ignore – just use defaults
  }

  // Login overlay is shown by default; app container hidden
  // User must authenticate to proceed
});
