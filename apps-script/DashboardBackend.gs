/**
 * Dashboard Backend — Google Apps Script
 *
 * Deploy as Web App:
 *   Execute as: Me
 *   Who has access: Anyone
 *
 * Sheet ID: 1u5VEcNt82Q3SlEEqilmu3TgdEwkl0C5F4E5T7ySnesY
 *
 * Required tabs:
 *   "Dashboard Users"       — access codes + buyer info
 *   "Dashboard Allocations" — SKU / Vinosmith ID / qty per buyer
 *   "Dashboard Orders"      — written by this script on checkout
 */

var SHEET_ID = '1W0V4iQbPHSEKW9r31bYNLi-ugFkjuByqZcGDt-z7ZHk';
var VINOSMITH_TOKEN = '7eaa41ed01571835bcbccf5e3a0e4474b4507e30c74ae15ee54e36fd4200528d';
var VINOSMITH_API = 'https://app.vinosmith.com/api/v1';
var CACHE_TTL = 21600; // 6 hours

/* ───────────────────────────────── CORS helper ─── */
function makeOutput(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/* Allow preflight from any origin */
function doOptions(e) {
  return makeOutput({ ok: true });
}

/* ─────────────────────────────── Main entry point ─── */
function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var action = body.action;

    if (action === 'login')       return makeOutput(handleLogin(body));
    if (action === 'allocations') return makeOutput(handleAllocations(body));
    if (action === 'order')       return makeOutput(handleOrder(body));

    return makeOutput({ success: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return makeOutput({ success: false, error: err.message });
  }
}

/* Also support GET for simple health check */
function doGet(e) {
  return makeOutput({ status: 'ok', service: 'Source Dashboard Backend' });
}

/* ─────────────────────────────────── LOGIN ─── */
function handleLogin(body) {
  var code = (body.code || '').trim().toUpperCase();
  if (!code) return { success: false, error: 'Access code required.' };

  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName('Dashboard Users');
  if (!sheet) return { success: false, error: 'Users tab not found.' };

  var data = sheet.getDataRange().getValues();
  // Row 0 = header
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var rowCode = String(row[0]).trim().toUpperCase();
    if (rowCode === code) {
      var active = row[5];
      if (active === false || String(active).toUpperCase() === 'FALSE') {
        return { success: false, error: 'This access code has been deactivated.' };
      }
      return {
        success: true,
        user: {
          code: rowCode,
          name: String(row[1]).trim(),
          company: String(row[2]).trim(),
          email: String(row[3]).trim(),
          phone: String(row[4]).trim()
        }
      };
    }
  }
  return { success: false, error: 'Invalid access code.' };
}

/* ────────────────────────────── ALLOCATIONS ─── */
function handleAllocations(body) {
  var code = (body.code || '').trim().toUpperCase();
  if (!code) return { success: false, error: 'Access code required.' };

  var ss = SpreadsheetApp.openById(SHEET_ID);

  // Verify user exists and is active
  var usersSheet = ss.getSheetByName('Dashboard Users');
  if (!usersSheet) return { success: false, error: 'Users tab not found.' };
  var userData = usersSheet.getDataRange().getValues();
  var userValid = false;
  for (var u = 1; u < userData.length; u++) {
    if (String(userData[u][0]).trim().toUpperCase() === code) {
      var active = userData[u][5];
      if (active === false || String(active).toUpperCase() === 'FALSE') {
        return { success: false, error: 'Access code deactivated.' };
      }
      userValid = true;
      break;
    }
  }
  if (!userValid) return { success: false, error: 'Invalid access code.' };

  // Read allocations
  var allocSheet = ss.getSheetByName('Dashboard Allocations');
  if (!allocSheet) return { success: false, error: 'Allocations tab not found.' };
  var allocData = allocSheet.getDataRange().getValues();

  // Read existing orders to compute remaining qty
  var orderedQty = getOrderedQuantities(ss, code);

  var allocations = [];
  for (var a = 1; a < allocData.length; a++) {
    var row = allocData[a];
    if (String(row[0]).trim().toUpperCase() !== code) continue;

    var sku = String(row[1]).trim();
    var vinosmithId = String(row[2]).trim();
    var qtyAllocated = parseFloat(row[3]) || 0;
    var customPrice = row[4] !== '' && row[4] !== null && row[4] !== undefined ? parseFloat(row[4]) : null;
    var notes = String(row[5] || '').trim();
    var wineDescription = String(row[6] || '').trim();
    var customName = String(row[7] || '').trim();
    var customVintage = String(row[8] || '').trim();
    var customFormat = String(row[9] || '').trim();
    var customProducer = String(row[10] || '').trim();

    var qtyOrdered = orderedQty[sku] || 0;
    var qtyRemaining = Math.max(0, qtyAllocated - qtyOrdered);

    allocations.push({
      sku: sku,
      vinosmith_id: vinosmithId,
      qty_allocated: qtyAllocated,
      qty_ordered: qtyOrdered,
      qty_remaining: qtyRemaining,
      custom_price: customPrice,
      notes: notes,
      wine_description: wineDescription,
      custom_name: customName,
      custom_vintage: customVintage,
      custom_format: customFormat,
      custom_producer: customProducer
    });
  }

  // Fetch wine details from Vinosmith API (server-side)
  var enriched = enrichWithVinosmith(allocations);

  // Group by country → producer
  var grouped = groupWines(enriched);

  return { success: true, allocations: enriched, grouped: grouped };
}

/* ──────────────── Compute ordered quantities ─── */
function getOrderedQuantities(ss, code) {
  var ordersSheet = ss.getSheetByName('Dashboard Orders');
  if (!ordersSheet) return {};

  var data = ordersSheet.getDataRange().getValues();
  var qty = {};
  // Columns: Timestamp | Order ID | Access Code | Company | Contact | Email | SKU | Wine | Producer | Qty | Unit Price | Line Total | Notes
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (String(row[2]).trim().toUpperCase() !== code) continue;
    var sku = String(row[6]).trim();
    var q = parseFloat(row[9]) || 0;
    qty[sku] = (qty[sku] || 0) + q;
  }
  return qty;
}

/* ──────────────── Vinosmith API enrichment ─── */
function enrichWithVinosmith(allocations) {
  var cache = CacheService.getScriptCache();

  for (var i = 0; i < allocations.length; i++) {
    var alloc = allocations[i];
    var vid = alloc.vinosmith_id;
    if (!vid) {
      // No Vinosmith ID — use sheet columns directly
      alloc.name = alloc.custom_name || alloc.sku;
      alloc.producer = alloc.custom_producer || '';
      alloc.vintage = alloc.custom_vintage || '';
      if (alloc.custom_format) {
        var fp = alloc.custom_format.split('/');
        alloc.unit_set = fp[0] ? fp[0].trim() : '';
        alloc.bottle_size = fp[1] ? fp[1].trim() : '';
      }
      if (alloc.custom_price !== null && alloc.custom_price !== undefined && !isNaN(alloc.custom_price)) {
        alloc.price = alloc.custom_price;
      } else {
        alloc.price = 0;
      }
      continue;
    }

    var cacheKey = 'vino_' + vid;
    var cached = cache.get(cacheKey);

    if (cached) {
      try {
        var wineData = JSON.parse(cached);
        mergeWineData(alloc, wineData);
        continue;
      } catch (e) { /* re-fetch */ }
    }

    // Fetch from Vinosmith
    try {
      var response = UrlFetchApp.fetch(VINOSMITH_API + '/wines/' + vid, {
        method: 'get',
        headers: { 'Authorization': 'Bearer ' + VINOSMITH_TOKEN },
        muteHttpExceptions: true
      });

      if (response.getResponseCode() === 200) {
        var json = JSON.parse(response.getContentText());
        var wine = json.wine || json;

        var wineData = {
          name: wine.name || '',
          producer: (wine.producer && wine.producer.name) ? wine.producer.name : '',
          producer_description: (wine.producer && wine.producer.description) ? wine.producer.description : '',
          country: (wine.producer && wine.producer.country) ? wine.producer.country : '',
          region: (wine.producer && wine.producer.region) ? wine.producer.region : '',
          appellation: wine.appellation || '',
          vintage: wine.vintage || '',
          bottle_size: wine.bottle_size || '',
          unit_set: wine.unit_set || '',
          dist: wine.dist || '',
          dist5: wine.dist5 || '',
          dist10: wine.dist10 || '',
          available: wine.available || 0,
          description: wine.description || '',
          farming: wine.farming || '',
          varietals: wine.varietals || [],
          images: extractImages(wine),
          tasting_notes: wine.tasting_notes || wine.description || '',
          vineyard: wine.vineyard || '',
          winemaking: wine.winemaking || '',
          aging: wine.aging || '',
          soil: wine.soil || '',
          expected_date: wine.expected_date || '',
          prearrival_qty: wine.prearrival_qty || ''
        };

        // Cache for 6 hours
        try {
          cache.put(cacheKey, JSON.stringify(wineData), CACHE_TTL);
        } catch (ce) { /* cache put failed, non-critical */ }

        mergeWineData(alloc, wineData);
      } else {
        // Non-200 response — fall back to sheet data
        alloc.name = alloc.custom_name || alloc.sku;
        alloc.producer = alloc.custom_producer || '';
        alloc.vintage = alloc.custom_vintage || '';
        if (alloc.custom_format) {
          var fp = alloc.custom_format.split('/');
          alloc.unit_set = fp[0] ? fp[0].trim() : '';
          alloc.bottle_size = fp[1] ? fp[1].trim() : '';
        }
        if (alloc.custom_price !== null && alloc.custom_price !== undefined && !isNaN(alloc.custom_price)) {
          alloc.price = alloc.custom_price;
        } else {
          alloc.price = 0;
        }
      }
    } catch (err) {
      // API failed — fall back to sheet data
      alloc.api_error = err.message;
      alloc.name = alloc.custom_name || alloc.sku;
      alloc.producer = alloc.custom_producer || '';
      alloc.vintage = alloc.custom_vintage || '';
      if (alloc.custom_format) {
        var fp = alloc.custom_format.split('/');
        alloc.unit_set = fp[0] ? fp[0].trim() : '';
        alloc.bottle_size = fp[1] ? fp[1].trim() : '';
      }
      if (alloc.custom_price !== null && alloc.custom_price !== undefined && !isNaN(alloc.custom_price)) {
        alloc.price = alloc.custom_price;
      } else {
        alloc.price = 0;
      }
    }
  }

  return allocations;
}

function extractImages(wine) {
  var imgs = [];
  if (wine.producer && wine.producer.images && wine.producer.images.length) {
    wine.producer.images.forEach(function(img) {
      if (img.url) imgs.push(img.url);
      else if (typeof img === 'string') imgs.push(img);
    });
  }
  if (wine.images && wine.images.length) {
    wine.images.forEach(function(img) {
      if (img.url) imgs.push(img.url);
      else if (typeof img === 'string') imgs.push(img);
    });
  }
  if (wine.image_url) imgs.push(wine.image_url);
  return imgs;
}

function mergeWineData(alloc, wineData) {
  // Sheet columns override API values when present
  alloc.name = alloc.custom_name || wineData.name;
  alloc.producer = wineData.producer || alloc.custom_producer || '';
  alloc.producer_description = wineData.producer_description;
  alloc.country = wineData.country;
  alloc.region = wineData.region;
  alloc.appellation = wineData.appellation;
  alloc.vintage = alloc.custom_vintage || wineData.vintage;

  if (alloc.custom_format) {
    // Parse "12/750ml" into unit_set and bottle_size
    var parts = alloc.custom_format.split('/');
    alloc.unit_set = parts[0] ? parts[0].trim() : wineData.unit_set;
    alloc.bottle_size = parts[1] ? parts[1].trim() : wineData.bottle_size;
  } else {
    alloc.bottle_size = wineData.bottle_size;
    alloc.unit_set = wineData.unit_set;
  }
  alloc.description = wineData.description;
  alloc.farming = wineData.farming;
  alloc.varietals = wineData.varietals;
  alloc.images = wineData.images;
  alloc.tasting_notes = wineData.tasting_notes;
  alloc.vineyard = wineData.vineyard;
  alloc.winemaking = wineData.winemaking;
  alloc.aging = wineData.aging;
  alloc.soil = wineData.soil;
  alloc.expected_date = wineData.expected_date;
  alloc.prearrival_qty = wineData.prearrival_qty;

  // Price: use custom_price if set, otherwise dist price from API
  if (alloc.custom_price === null || alloc.custom_price === undefined || isNaN(alloc.custom_price)) {
    var dist = parseFloat(String(wineData.dist).replace(/[^0-9.]/g, ''));
    alloc.price = isNaN(dist) ? 0 : dist;
  } else {
    alloc.price = alloc.custom_price;
  }

  alloc.dist = wineData.dist;
  alloc.dist5 = wineData.dist5;
  alloc.dist10 = wineData.dist10;
  alloc.available = wineData.available;
}

/* ──────────────── Group wines by country → producer ─── */
function groupWines(allocations) {
  var countries = {};

  allocations.forEach(function(w) {
    var country = w.country || 'Allocations';
    var producer = w.producer || 'Unknown Producer';
    var region = w.region || '';

    if (!countries[country]) countries[country] = {};
    if (!countries[country][producer]) {
      countries[country][producer] = {
        name: producer,
        region: region,
        description: w.producer_description || '',
        images: w.images || [],
        wines: []
      };
    }
    countries[country][producer].wines.push(w);
  });

  // Convert to array structure
  var result = [];
  Object.keys(countries).sort().forEach(function(countryName) {
    var producers = countries[countryName];
    var producerList = [];
    Object.keys(producers).sort().forEach(function(pName) {
      producerList.push(producers[pName]);
    });
    result.push({ country: countryName, producers: producerList });
  });

  return result;
}

/* ──────────────────────────────────── ORDER ─── */
function handleOrder(body) {
  var code = (body.code || '').trim().toUpperCase();
  if (!code) return { success: false, error: 'Access code required.' };

  var items = body.items;
  if (!items || !items.length) return { success: false, error: 'No items in order.' };

  var company = (body.company || '').trim();
  var contact = (body.contact || '').trim();
  var email = (body.email || '').trim();
  var notes = (body.notes || '').trim();

  if (!company || !contact || !email) {
    return { success: false, error: 'Company, contact name, and email are required.' };
  }

  var ss = SpreadsheetApp.openById(SHEET_ID);

  // Verify user
  var usersSheet = ss.getSheetByName('Dashboard Users');
  var userData = usersSheet.getDataRange().getValues();
  var userValid = false;
  var userName = '';
  for (var u = 1; u < userData.length; u++) {
    if (String(userData[u][0]).trim().toUpperCase() === code) {
      userValid = true;
      userName = String(userData[u][1]).trim();
      break;
    }
  }
  if (!userValid) return { success: false, error: 'Invalid access code.' };

  // Read allocations to validate quantities
  var allocSheet = ss.getSheetByName('Dashboard Allocations');
  var allocData = allocSheet.getDataRange().getValues();
  var allocMap = {};
  for (var a = 1; a < allocData.length; a++) {
    if (String(allocData[a][0]).trim().toUpperCase() === code) {
      var sku = String(allocData[a][1]).trim();
      allocMap[sku] = parseFloat(allocData[a][3]) || 0;
    }
  }

  // Get already-ordered quantities
  var orderedQty = getOrderedQuantities(ss, code);

  // Validate each item (skip validation for catalog requests)
  for (var v = 0; v < items.length; v++) {
    var item = items[v];
    if (item.source === 'catalog' || allocMap[item.sku] === undefined) continue;
    var allocated = allocMap[item.sku] || 0;
    var alreadyOrdered = orderedQty[item.sku] || 0;
    var remaining = allocated - alreadyOrdered;
    if (item.qty > remaining) {
      return {
        success: false,
        error: 'Quantity for ' + (item.wine || item.sku) + ' exceeds remaining allocation (' + remaining + ' remaining).'
      };
    }
  }

  // Write order rows
  var ordersSheet = ss.getSheetByName('Dashboard Orders');
  if (!ordersSheet) {
    // Create the tab if it doesn't exist
    ordersSheet = ss.insertSheet('Dashboard Orders');
    ordersSheet.appendRow([
      'Timestamp', 'Order ID', 'Access Code', 'Company', 'Contact',
      'Email', 'SKU', 'Wine', 'Producer', 'Qty', 'Unit Price',
      'Line Total', 'Notes'
    ]);
  }

  var orderId = 'ORD-' + Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyyyMMdd-HHmmss');
  var timestamp = new Date();
  var rows = [];

  items.forEach(function(item) {
    var lineTotal = (item.price || 0) * (item.qty || 0);
    var isCatalog = item.source === 'catalog' || allocMap[item.sku] === undefined;
    var itemNotes = notes;
    if (isCatalog) {
      itemNotes = (notes ? notes + ' | ' : '') + 'CATALOG REQUEST';
    }
    rows.push([
      timestamp,
      orderId,
      code,
      company,
      contact,
      email,
      item.sku || '',
      item.wine || '',
      item.producer || '',
      item.qty || 0,
      item.price || 0,
      lineTotal,
      itemNotes
    ]);
  });

  // Batch write
  if (rows.length > 0) {
    var lastRow = ordersSheet.getLastRow();
    ordersSheet.getRange(lastRow + 1, 1, rows.length, 13).setValues(rows);
  }

  return {
    success: true,
    order_id: orderId,
    message: 'Order ' + orderId + ' submitted successfully. ' + items.length + ' item(s).'
  };
}

/*
 * BACKFILL PRODUCER BIOS
 * Run from Apps Script editor: Run > fetchProducerBios
 * Grabs one wine per producer from the Allocations sheet,
 * fetches producer description from Vinosmith, writes JSON
 * to _ProducerBios sheet tab.
 */
function fetchProducerBios() {
  var ss = SpreadsheetApp.openById(SHEET_ID);

  // Step 1: collect unique Vinosmith IDs (one per producer) from allocations
  var allocSheet = ss.getSheetByName('Dashboard Allocations');
  var wineIds = {};
  if (allocSheet) {
    var data = allocSheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      var vid = String(data[i][2] || '').trim();
      if (vid) wineIds[vid] = true;
    }
  }

  var ids = Object.keys(wineIds);
  Logger.log('Found ' + ids.length + ' unique Vinosmith IDs in allocations');

  // Step 2: also try /producers endpoint
  var producers = {};
  try {
    var endpoints = ['/producers', '/producers?per_page=500'];
    for (var e = 0; e < endpoints.length; e++) {
      var resp = UrlFetchApp.fetch(VINOSMITH_API + endpoints[e], {
        method: 'get',
        headers: { 'Authorization': 'Bearer ' + VINOSMITH_TOKEN },
        muteHttpExceptions: true
      });
      if (resp.getResponseCode() === 200) {
        var pJson = JSON.parse(resp.getContentText());
        var pList = pJson.producers || pJson.data || pJson;
        if (Array.isArray(pList)) {
          pList.forEach(function(p) {
            if (p.name && p.description) producers[p.name] = p.description;
          });
          Logger.log('Got ' + Object.keys(producers).length + ' producers from /producers endpoint');
          break;
        }
      }
    }
  } catch (err) {
    Logger.log('/producers endpoint not available: ' + err.message);
  }

  // Step 3: fetch individual wines to fill gaps
  if (ids.length > 0) {
    var seenProducers = {};
    for (var j = 0; j < ids.length; j++) {
      try {
        var resp2 = UrlFetchApp.fetch(VINOSMITH_API + '/wines/' + ids[j], {
          method: 'get',
          headers: { 'Authorization': 'Bearer ' + VINOSMITH_TOKEN },
          muteHttpExceptions: true
        });
        if (resp2.getResponseCode() === 200) {
          var wJson = JSON.parse(resp2.getContentText());
          var wine = wJson.wine || wJson;
          var p = wine.producer;
          if (p && p.name && p.description && !producers[p.name] && !seenProducers[p.name]) {
            producers[p.name] = p.description;
            seenProducers[p.name] = true;
          }
        }
      } catch (err2) {
        Logger.log('Error fetching wine ' + ids[j] + ': ' + err2.message);
      }
      if (j % 20 === 0 && j > 0) {
        Logger.log('Fetched ' + j + '/' + ids.length + ' wines, ' + Object.keys(producers).length + ' producers');
        Utilities.sleep(100);
      }
    }
  }

  var result = JSON.stringify(producers, null, 2);
  Logger.log('DONE: ' + Object.keys(producers).length + ' producer bios collected');

  var bioSheet = ss.getSheetByName('_ProducerBios');
  if (bioSheet) ss.deleteSheet(bioSheet);
  bioSheet = ss.insertSheet('_ProducerBios');
  bioSheet.getRange(1, 1).setValue(result);
  Logger.log('Written to _ProducerBios tab. Copy cell A1 and save as producer-bios.json');
}
