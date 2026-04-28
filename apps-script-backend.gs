// ═══════════════════════════════════════════════════════════════
// HawkSpot — Google Apps Script Backend v2.0
// ─────────────────────────────────────────────────────────────
// SETUP STEPS:
//   1. Replace SPREADSHEET_ID below with your actual Sheet ID
//   2. Deploy → New Deployment → Web App
//      Execute as: Me
//      Who has access: Anyone
//   3. IMPORTANT: After deploying, run initializeSheets() manually
//      once from the Apps Script editor to create all tabs & headers
//   4. Copy the /exec URL into index.html → APPS_SCRIPT_URL
// ═══════════════════════════════════════════════════════════════

const SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID_HERE'; // ← Replace this
const DRIVE_ROOT     = 'HawkSpot';

const TABS = {
  1: 'BIC Execution',
  2: 'Competitor Intelligence',
  3: 'Product Availability',
  4: 'Expiry Management',
  5: 'Near-Expiry Liquidation'
};

// ── HEADERS CONFIG ───────────────────────────────────────────
const COMMON = ['Timestamp','Submitted By','Role','Distributor','Shop Name','City','Channel','Sub-Channel'];

const HEADERS = {
  1: [...COMMON, 'Slot 1 – Shop Facia', 'Slot 2 – Category Shelf', 'Slot 3 – Secondary Display', 'Slot 4 – POSM/Poster', 'Slot 5 – Context Shot'],
  2: [...COMMON, 'Competitor Name', 'T-to-R Margin %', 'On-Invoice', 'Off-Invoice', 'Shelf Rent Primary', 'Shelf Rent Secondary', 'TPR', 'Snapshot URL'],
  3: [...COMMON, ...getAllSkus()],
  4: [...COMMON, 'SKU Code', 'Quantity', 'MFG Date', 'Expiry Date', 'Photo URL', 'Expiry Flag'],
  5: [...COMMON, 'SKU Code', 'Quantity', 'Urgent Flag']
};

// ═══════════════════════════════════════════════════════════════
// doGet — called by browser preflight / init check
// Returns JSON confirming the endpoint is live + creates sheets
// ═══════════════════════════════════════════════════════════════
function doGet(e) {
  initializeSheets(); // Ensure all tabs exist
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok', message: 'HawkSpot backend is live', version: '2.0' }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ═══════════════════════════════════════════════════════════════
// doPost — main handler for all PWA submissions
// ═══════════════════════════════════════════════════════════════
function doPost(e) {
  // ── CORS headers (required for fetch from GitHub Pages) ──────
  // NOTE: Apps Script Web Apps deployed as "Anyone" do support
  // cross-origin POST with Content-Type: text/plain (no preflight)
  // If you use Content-Type: application/json you need a proxy.
  // The PWA sends Content-Type: text/plain to avoid CORS preflight.

  try {
    if (!e || !e.postData || !e.postData.contents) {
      throw new Error('Empty request body');
    }

    const payload = JSON.parse(e.postData.contents);
    const module  = parseInt(payload.module);

    if (!module || !TABS[module]) {
      throw new Error(`Unknown module: ${module}`);
    }

    // Ensure tabs + headers exist (idempotent)
    const sheet = getOrCreateSheet(module);

    // Handle image / video uploads → Drive
    let photoUrls = {};
    const dateStr  = Utilities.formatDate(new Date(payload.timestamp || new Date()), 'Asia/Karachi', 'yyyy-MM-dd');
    const shopName = sanitize(payload.shop?.shopname || 'Unknown');
    const folder   = getOrCreateFolder(`${DRIVE_ROOT}/${dateStr}/${shopName}`);

    // Module 1 — BIC photos
    if (module === 1 && payload.data?.photos) {
      Object.entries(payload.data.photos).forEach(([key, dataUrl]) => {
        if (dataUrl && dataUrl.startsWith('data:')) {
          const url = saveImage(dataUrl, `${shopName}_${key}.jpg`, folder);
          photoUrls[key] = url;
        }
      });
    }
    // Module 2 — Snapshot
    if (module === 2 && payload.data?.snapshotDataUrl) {
      photoUrls['snapshot'] = saveImage(payload.data.snapshotDataUrl, `${shopName}_snapshot.jpg`, folder);
    }
    // Module 4 — Expiry photo
    if (module === 4 && payload.data?.photoDataUrl) {
      photoUrls['expiry'] = saveImage(payload.data.photoDataUrl, `${shopName}_expiry.jpg`, folder);
    }

    // Build & append row
    const row = buildRow(module, payload, photoUrls);
    sheet.appendRow(row);

    // Post-append formatting (near-expiry highlight)
    const lastRow = sheet.getLastRow();
    if (module === 4 || module === 5) {
      const expiryDate = (module === 4) ? payload.data?.expiryDate : null;
      if (expiryDate) {
        const daysLeft = Math.ceil((new Date(expiryDate) - new Date()) / 86400000);
        if (daysLeft <= 90) {
          sheet.getRange(lastRow, 1, 1, row.length).setBackground('#FFCCCC');
        }
      }
      if (payload.data?.urgentFlag) {
        sheet.getRange(lastRow, 1, 1, row.length).setBackground('#FFCCCC');
      }
    }

    return jsonResponse({ status: 'success', id: payload.id, urls: photoUrls });

  } catch (err) {
    Logger.log('doPost error: ' + err.message + '\n' + err.stack);
    return jsonResponse({ status: 'error', message: err.message });
  }
}

// ═══════════════════════════════════════════════════════════════
// ROW BUILDER
// ═══════════════════════════════════════════════════════════════
function buildRow(module, payload, photoUrls) {
  const ts   = payload.timestamp ? new Date(payload.timestamp) : new Date();
  const shop = payload.shop || {};
  const common = [
    Utilities.formatDate(ts, 'Asia/Karachi', 'yyyy-MM-dd HH:mm:ss'),
    payload.user        || '',
    payload.role        || '',
    payload.distributor || '',
    shop.shopname       || '',
    shop.city           || '',
    shop.channel        || '',
    shop.subchannel     || ''
  ];

  if (module === 1) {
    return [...common,
      photoUrls['slot1'] || '',
      photoUrls['slot2'] || '',
      photoUrls['slot3'] || '',
      photoUrls['slot4'] || '',
      photoUrls['slot5'] || ''
    ];
  }

  if (module === 2) {
    const d = payload.data || {};
    const fmt = (f) => {
      if (!f || !f.value) return '';
      return `${f.value} (${f.type === 'pct' ? '% of Sales' : 'Fixed Amount'})`;
    };
    return [...common,
      d.competitorName || '',
      d.margin         || '',
      fmt(d['on_invoice']),
      fmt(d['off_invoice']),
      fmt(d['shelf_rent___primary']),
      fmt(d['shelf_rent___secondary']),
      fmt(d['tpr']),
      photoUrls['snapshot'] || ''
    ];
  }

  if (module === 3) {
    const avail = payload.data?.availability || {};
    const skuCols = getAllSkus().map(sku => {
      const e = avail[sku];
      return e ? `${e.qty} ${e.unit}` : '';
    });
    return [...common, ...skuCols];
  }

  if (module === 4) {
    const d = payload.data || {};
    const exp = d.expiryDate ? new Date(d.expiryDate) : null;
    const daysLeft = exp ? Math.ceil((exp - new Date()) / 86400000) : null;
    const flag = (daysLeft !== null && daysLeft <= 90) ? `URGENT — ${daysLeft} days left` : '';
    return [...common, d.sku||'', d.qty||'', d.mfgDate||'', d.expiryDate||'', photoUrls['expiry']||'', flag];
  }

  if (module === 5) {
    const d = payload.data || {};
    return [...common, d.sku||'', d.qty||'', d.urgentFlag||''];
  }

  return common;
}

// ═══════════════════════════════════════════════════════════════
// SHEET HELPERS
// ═══════════════════════════════════════════════════════════════
function getOrCreateSheet(module) {
  const ss   = SpreadsheetApp.openById(SPREADSHEET_ID);
  const name = TABS[module];
  let sheet  = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    applyHeaders(sheet, HEADERS[module]);
  }
  return sheet;
}

function applyHeaders(sheet, headers) {
  sheet.appendRow(headers);
  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange
    .setBackground('#0F172A')
    .setFontColor('#94A3B8')
    .setFontWeight('bold')
    .setFontSize(10);
  sheet.setFrozenRows(1);
  // Auto-resize columns
  headers.forEach((_, i) => {
    sheet.setColumnWidth(i + 1, Math.max(120, headers[i].length * 8));
  });
}

// Called once manually to set up all tabs
function initializeSheets() {
  for (let m = 1; m <= 5; m++) {
    getOrCreateSheet(m);
  }
  Logger.log('All HawkSpot sheets initialized successfully.');
}

// ═══════════════════════════════════════════════════════════════
// DRIVE HELPERS
// ═══════════════════════════════════════════════════════════════
function getOrCreateFolder(path) {
  let current = DriveApp.getRootFolder();
  path.split('/').filter(Boolean).forEach(part => {
    const iter = current.getFoldersByName(part);
    current    = iter.hasNext() ? iter.next() : current.createFolder(part);
  });
  return current;
}

function saveImage(dataUrl, filename, folder) {
  try {
    const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!m) return '';
    const blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], filename);
    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return `https://drive.google.com/uc?export=view&id=${file.getId()}`;
  } catch (e) {
    Logger.log('saveImage error: ' + e.message);
    return '';
  }
}

// ═══════════════════════════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════════════════════════
function sanitize(name) {
  return (name || 'Unknown').replace(/[^\w\s\-]/g, '').replace(/\s+/g, '_').substring(0, 40);
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getAllSkus() {
  const SKU_MASTER = {
    'Chips':    ['SKU00001','SKU00038','SKU00058','SKU00002'],
    'Munchese': ['SKU00003','SKU00004','SKU00056','SKU00069','SKU00005','SKU00006'],
    'Nimko':    ['SKU00008','SKU00009','SKU00010','SKU00011','SKU00012','SKU00013','SKU00014','SKU00015','SKU00016','SKU00017','SKU00018','SKU00019','SKU00020','SKU00021','SKU00022','SKU00023','SKU00024','SKU00025','SKU00026','SKU00027','SKU00028','SKU00029','SKU00030','SKU00037','SKU00039','SKU00040','SKU00041','SKU00042','SKU00043','SKU00044','SKU00045','SKU00046','SKU00047','SKU00048','SKU00049','SKU00050','SKU00051','SKU00052','SKU00053','SKU00054','SKU00055','SKU00057','SKU00059','SKU00060','SKU00061','SKU00062','SKU00063','SKU00064','SKU00068'],
    'Nuts':     ['SKU00031','SKU00032','SKU00033','SKU00034','SKU00035','SKU00036','SKU00065','SKU00066','SKU00067']
  };
  return Object.values(SKU_MASTER).flat();
}

// ═══════════════════════════════════════════════════════════════
// TEST FUNCTION — run manually from Apps Script editor
// ═══════════════════════════════════════════════════════════════
function testPost() {
  const payload = {
    id: Date.now(),
    module: 1,
    timestamp: new Date().toISOString(),
    user: 'Test User',
    role: 'TSE',
    distributor: 'Rauf Sons',
    shop: { shopname: 'Test Shop', city: 'Lahore', channel: 'Retail', subchannel: 'Gen Store' },
    data: { photos: { slot1: '', slot2: '' } }
  };
  const result = doPost({ postData: { contents: JSON.stringify(payload) } });
  Logger.log(result.getContent());
}
