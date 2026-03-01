/**
 * Women in Wine — Pre-Arrival Orders
 * Google Apps Script (bound to spreadsheet)
 *
 * SETUP:
 * 1. Open your Google Sheet → Extensions → Apps Script
 * 2. Paste this into Code.gs
 * 3. Create a new HTML file (File → New → HTML) named "Index"
 * 4. Paste the Index.html content there
 * 5. Save, then reload the spreadsheet
 * 6. A "Pre-Arrivals" menu will appear — click "Open Order Form"
 */

var SHEET_NAME = 'Orders';
var OFFER_NAME = 'Women in Wine — Spring 2026';

/* ── Auto-show popup + menu when spreadsheet opens ── */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Pre-Arrivals')
    .addItem('Open Order Form', 'showOrderForm')
    .addItem('Enable Auto-Popup (run once)', 'installAutoOpen')
    .addToUi();
}

/* ── Installable trigger version — this one CAN show the dialog ── */
function autoShowForm() {
  showOrderForm();
}

/* ── Run once to enable auto-popup on every spreadsheet open ── */
function installAutoOpen() {
  // Remove any existing onOpen triggers to avoid duplicates
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'autoShowForm') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  // Create installable trigger
  ScriptApp.newTrigger('autoShowForm')
    .forSpreadsheet(SpreadsheetApp.getActive())
    .onOpen()
    .create();

  SpreadsheetApp.getUi().alert('Auto-popup enabled! The order form will now open every time this spreadsheet is loaded.');
}

/* ── Show the order form as a popup dialog ── */
function showOrderForm() {
  var html = HtmlService.createHtmlOutputFromFile('Index')
    .setWidth(720)
    .setHeight(680);
  SpreadsheetApp.getUi().showModalDialog(html, 'Women in Wine — Spring 2026');
}

/* ── Called from google.script.run (client-side) ── */
function submitOrderFromClient(data) {
  return processOrder(data);
}

/* ── Core order processing ── */
function processOrder(data) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);

  // Create the sheet if it doesn't exist
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow([
      'Timestamp',
      'Order ID',
      'Offer',
      'Company',
      'Contact',
      'Email',
      'Phone',
      'Notes',
      'Wine',
      'Producer',
      'Format',
      'Qty (cases)',
      'Unit Price',
      'Line Total'
    ]);

    // Format header row
    var headerRange = sheet.getRange(1, 1, 1, 14);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#8b4789');
    headerRange.setFontColor('#ffffff');
    sheet.setFrozenRows(1);

    // Set column widths
    sheet.setColumnWidth(1, 160);
    sheet.setColumnWidth(2, 100);
    sheet.setColumnWidth(3, 140);
    sheet.setColumnWidth(4, 160);
    sheet.setColumnWidth(5, 140);
    sheet.setColumnWidth(6, 200);
    sheet.setColumnWidth(7, 120);
    sheet.setColumnWidth(8, 200);
    sheet.setColumnWidth(9, 300);
    sheet.setColumnWidth(10, 160);
    sheet.setColumnWidth(11, 100);
    sheet.setColumnWidth(12, 100);
    sheet.setColumnWidth(13, 100);
    sheet.setColumnWidth(14, 100);
  }

  var timestamp = new Date();
  var orderId = data.orderId || generateOrderId_();
  var items = data.items || [];

  if (items.length === 0) {
    return { status: 'error', message: 'No items in order.' };
  }

  // Write one row per line item
  var rows = [];
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    var unitPrice = parseFloat(item.price || item.unitPrice) || 0;
    var qty = parseFloat(item.quantity) || 0;
    var lineTotal = unitPrice * qty;

    rows.push([
      timestamp,
      orderId,
      OFFER_NAME,
      data.company || '',
      data.contact || '',
      data.email || '',
      data.phone || '',
      i === 0 ? (data.notes || '') : '',
      item.wine || '',
      item.producer || '',
      item.format || '12/750ml',
      qty,
      unitPrice,
      lineTotal
    ]);
  }

  // Batch write
  if (rows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 14).setValues(rows);
  }

  // Format currency columns
  var lastRow = sheet.getLastRow();
  var startRow = lastRow - rows.length + 1;
  sheet.getRange(startRow, 13, rows.length, 2).setNumberFormat('$#,##0.00');
  sheet.getRange(startRow, 12, rows.length, 1).setNumberFormat('0.00');

  return {
    status: 'success',
    message: 'Order ' + orderId + ' received. Thank you!',
    orderId: orderId
  };
}

/* ── Helpers ── */
function generateOrderId_() {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var id = 'WIW-';
  for (var i = 0; i < 6; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

/* ── Test function ── */
function testOrder() {
  var testData = {
    orderId: 'WIW-TEST01',
    company: 'Test Wine Shop',
    contact: 'Jane Doe',
    email: 'jane@test.com',
    phone: '555-0100',
    notes: 'Test order',
    items: [
      { wine: '2022 Wechsler, Riesling, Trocken', producer: 'Katharina Wechsler', price: 216, quantity: 2, format: '12/750ml' },
      { wine: '2020 Brandini, Barolo, La Morra', producer: 'Agricola Brandini', price: 528, quantity: 1, format: '12/750ml' }
    ]
  };

  var result = processOrder(testData);
  Logger.log(result);
}
