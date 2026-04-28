# HawkSpot v2.0 — Deployment Guide

## Files to Upload to GitHub
```
index.html          ← Main PWA (redesigned enterprise UI)
manifest.json       ← PWA manifest
sw.js               ← Service worker
icon-192.png        ← App icon (create separately)
icon-512.png        ← App icon (create separately)
```

---

## Step 1 — GitHub Pages
Upload all files to your repo root. GitHub Pages auto-serves from `main` branch.
Your URL: `https://skldjf9203.github.io/hawkspot/`

---

## Step 2 — Google Apps Script Setup

### Paste the backend code
1. Open [script.google.com](https://script.google.com) → New project
2. Paste contents of `apps-script-backend.gs`
3. Replace `YOUR_SPREADSHEET_ID_HERE` with your Sheet ID

### Deploy correctly (CRITICAL)
1. Click **Deploy → New deployment**
2. Type: **Web App**
3. Execute as: **Me**
4. Who has access: **Anyone** ← must be "Anyone", not "Anyone with Google account"
5. Click **Deploy** → Copy the `/exec` URL

### Initialize Sheet tabs (RUN THIS ONCE)
In the Apps Script editor, select `initializeSheets` from the function dropdown and click ▶ Run.
This creates all 5 sheet tabs with headers automatically. Check the Sheet to confirm.

---

## Step 3 — Connect PWA to Backend

In `index.html`, find:
```js
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/YOUR_SCRIPT_ID_HERE/exec';
```
Replace with your actual `/exec` URL.

---

## Why PWA ↔ Sheet Was Not Communicating (FIXED)

The issue was **CORS (Cross-Origin Resource Sharing)**. When a browser on GitHub Pages
makes a `fetch()` to `script.google.com`, Google's servers need to allow it.

### The Fix Applied:
1. **`mode: 'no-cors'`** added to all fetch calls in index.html — this bypasses CORS preflight
2. **`Content-Type: 'text/plain'`** used instead of `application/json` — prevents preflight
3. **`doGet()`** added to backend — lets you test the URL directly in a browser
4. **`initializeSheets()`** function added — creates all tabs/headers in one click

### How to verify it's working:
1. Open your Apps Script `/exec` URL directly in a browser
2. You should see: `{"status":"ok","message":"HawkSpot backend is live","version":"2.0"}`
3. Check your Google Sheet — all 5 tabs should be created

### If still not syncing:
- Check Apps Script → Executions log for errors
- Make sure deployment is "Execute as: Me" and "Anyone" access
- After any code change, you MUST create a **New Deployment** (not redeploy existing)

---

## Account System

Users can **Sign Up** with name + email + password. Accounts stored in localStorage.
For quick admin access use password hint: `admin0123`

RSM/ASM roles see the Admin Dashboard nav item.

---

## Theme

Light/Dark toggle is the ☀️/🌙 button in the top bar. Preference is saved.

---

## Sheet Tab Structure

| Tab | Module | Key Columns |
|-----|--------|-------------|
| BIC Execution | 1 | 5 Drive photo URLs |
| Competitor Intelligence | 2 | Trade terms, snapshot |
| Product Availability | 3 | All SKUs as columns |
| Expiry Management | 4 | MFG/Expiry dates, auto flag |
| Near-Expiry Liquidation | 5 | SKU, qty, urgent flag |

Near-expiry rows (≤90 days) are highlighted red automatically.
