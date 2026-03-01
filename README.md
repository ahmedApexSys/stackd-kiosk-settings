# STACKD Kiosk Settings

A standalone **Electron** desktop application for configuring STACKD Kiosk deployments. Provides a secure, password-protected interface for managing API connections, branch settings, printers, receipt designs, and item-to-printer mappings.

## Features

- **Password-protected access** via ControlPanel device validation
- **Auto-detect machine serial number** (BIOS serial via WMIC/PowerShell)
- **License validation** — validates device against ControlPanel (serial + branch + activation date)
- **API connection management** — configure and test Kiosk API server
- **Branch & Menu configuration** — set branch ID, menu ID, device code
- **Printer management** — load, check status (TCP ping), and test ESC/POS printers
- **Receipt design selection** — choose cheque and kitchen slip layouts
- **Item-to-printer mapping** — view which kitchen printer each menu item routes to
- **Fawry payment terminal** — configure and test local Fawry service
- **Import/Export** settings as JSON
- **Auto-saves to Kiosk app** — settings.json is also written to KioskApp directory

## Tech Stack

| Layer     | Technology           |
| --------- | -------------------- |
| Desktop   | Electron 40          |
| UI        | Pure HTML/CSS/JS     |
| Printing  | ESC/POS over raw TCP |
| Security  | SHA256 password hash |
| Build     | electron-builder     |

## Project Structure

```
KioskSettings/
  electron/
    main.js          # Electron main process (settings I/O, API proxy, serial detection, validation)
    preload.js       # Context bridge for IPC (settingsAPI)
  src/
    index.html       # Login overlay + settings UI (tabs: Connection, Branch, Printers, Designs, etc.)
    css/styles.css   # Full UI styling (dark theme, login, cards, tables)
    js/renderer.js   # UI logic (login flow, form binding, API calls, printer checks)
  settings.json      # Persisted configuration
  package.json       # Build config (electron-builder)
```

## Prerequisites

- **Node.js** 20+ and **npm** 10+
- **Git**
- **Windows 10/11** (64-bit) — required for WMIC serial detection

## Quick Start (Development)

```bash
# Clone
git clone https://github.com/ahmedApexSys/stackd-kiosk-settings.git
cd stackd-kiosk-settings

# Install
npm install

# Run in development mode
npm start
```

## Build for Production

```bash
npm run build
```

Output files in `release/`:
- `STACKD-Kiosk-Settings-1.0.0-portable.exe` — Portable (no install, run directly)
- `STACKD Kiosk Settings Setup 1.0.0.exe` — Windows installer

## Setup Instructions

### 1. Register Device in ControlPanel

Before using the Settings EXE, the device must be registered in the [ControlPanel](https://github.com/Apex4Systems/ControlPanel):

1. Open the ControlPanel admin (https://apex-control-panel.tryasp.net)
2. Create a **Company** (if not exists)
3. Create a **Branch** under the company
4. Add a **Device** under the branch:
   - **Serial No**: The machine's BIOS serial number (shown on the Settings EXE login screen)
   - **Branch ID**: The branch this kiosk belongs to
   - **IsActive**: Set to `true`
   - **Activation Date**: Current date (license expires 1 year from this date)
   - **Type**: Device type code

### 2. Get the Device Password

The password is automatically generated from: `SHA256(serialNo + ":" + companySettingId)` → first 8 hex characters (uppercase).

The ControlPanel API returns this password hash in the `/api/Device/validate` response. Your administrator can retrieve it from the ControlPanel.

### 3. Deploy Settings EXE

1. Copy the portable EXE to the kiosk machine
2. Run `STACKD-Kiosk-Settings-1.0.0-portable.exe`
3. On the login screen:
   - **Control Panel URL**: `https://apex-control-panel.tryasp.net` (pre-filled)
   - **Branch ID**: Your branch ID (e.g., `1`)
   - **Device Serial**: Auto-detected (read-only)
   - **Password**: Enter the 8-character device password
4. Click **Unlock Settings**
5. Configure:
   - **Connection tab**: API Base URL, API Key
   - **Branch tab**: Branch ID, Menu ID, Device Code
   - **Printers tab**: Load printers, select receipt printer
   - **Designs tab**: Choose cheque and kitchen slip designs
   - **Advanced tab**: Service charge %, tax %, timeouts, locale
6. Click **Save Settings**

### 4. Verify Configuration

- Use **Test Connection** to verify API connectivity
- Use **Refresh Printers** then **Check All Status** to verify printer connectivity
- Use **Verify Menu** to confirm menu data loads correctly
- Use **Test Fawry Health** if using Fawry payment

## Settings File

The `settings.json` is saved alongside the EXE and also auto-copied to the KioskApp directory:

```json
{
  "controlPanelUrl": "https://apex-control-panel.tryasp.net",
  "apiBaseUrl": "https://kiosk.tryasp.net",
  "apiKey": "your-api-key",
  "branchId": 1,
  "menuId": 2,
  "deviceCode": "KIOSK-001",
  "fawryBaseUrl": "http://localhost:5050",
  "receiptPrinterId": null,
  "chequeDesignCode": "CHEQUE_A",
  "kitchenDesignCode": "KITCHEN_A",
  "serviceChargePercent": 12,
  "taxPercent": 14,
  "idleTimeoutMs": 120000,
  "menuRefreshMs": 300000,
  "defaultLocale": "en",
  "deviceValidated": true,
  "deviceSerialNo": "ABCD1234",
  "licenseExpiry": "2027-03-01T00:00:00Z"
}
```

## Security Model

```
┌─────────────────────────────────────┐
│         Settings EXE (Electron)      │
│                                      │
│  1. Detect BIOS serial (WMIC)        │
│  2. Show login overlay               │
│  3. User enters password + branchId  │
│                                      │
│  4. Call ControlPanel /validate      │────► ControlPanel API
│     (serialNo + branchId)            │      ├─ Device exists?
│                                      │      ├─ IsActive?
│  5. Compare password hash            │      ├─ Not expired?
│  6. If valid → unlock settings       │      └─ Return passwordHash
│                                      │
└─────────────────────────────────────┘
```

## Related Repositories

| Repository | Description |
| ---------- | ----------- |
| [stackd-kiosk-app](https://github.com/ahmedApexSys/stackd-kiosk-app) | Angular + Electron kiosk app |
| [KioskSettingsAdmin](https://github.com/ahmedApexSys/KioskSettingsAdmin) | .NET 9 backend API |
| [ControlPanel](https://github.com/Apex4Systems/ControlPanel) | Device management & licensing |

## License

Private — All rights reserved.
