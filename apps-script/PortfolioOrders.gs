/**
 * The Source Portfolio — Order Receiver
 * Standalone Google Apps Script (deployed as web app)
 *
 * SETUP:
 * 1. Go to https://script.google.com → New Project
 * 2. Paste this code into Code.gs
 * 3. Click Deploy → New deployment
 * 4. Type: Web app
 * 5. Execute as: Me
 * 6. Who has access: Anyone
 * 7. Click Deploy, authorize, copy the URL
 * 8. Paste the URL into the-source-portfolio.html as SCRIPT_URL
 */

var SPREADSHEET_ID = '1u5VEcNt82Q3SlEEqilmu3TgdEwkl0C5F4E5T7ySnesY';
var SHEET_NAME = 'Orders';
var OFFER_NAME = 'The Source Portfolio';

/* ── Web app entry point ── */
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var result = processOrder(data);
    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/* ── Also allow GET for testing ── */
function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok', message: 'Portfolio order endpoint is live.' }))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ── Core order processing ── */
function processOrder(data) {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SHEET_NAME);

  // Create the sheet if it doesn't exist
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow([
      'Timestamp',
      'Order ID',
      'Offer',
      'Warehouse',
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
    var headerRange = sheet.getRange(1, 1, 1, 15);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#5a3e2b');
    headerRange.setFontColor('#ffffff');
    sheet.setFrozenRows(1);

    // Set column widths
    sheet.setColumnWidth(1, 160);  // Timestamp
    sheet.setColumnWidth(2, 100);  // Order ID
    sheet.setColumnWidth(3, 140);  // Offer
    sheet.setColumnWidth(4, 120);  // Warehouse
    sheet.setColumnWidth(5, 160);  // Company
    sheet.setColumnWidth(6, 140);  // Contact
    sheet.setColumnWidth(7, 200);  // Email
    sheet.setColumnWidth(8, 120);  // Phone
    sheet.setColumnWidth(9, 200);  // Notes
    sheet.setColumnWidth(10, 300); // Wine
    sheet.setColumnWidth(11, 160); // Producer
    sheet.setColumnWidth(12, 100); // Format
    sheet.setColumnWidth(13, 100); // Qty
    sheet.setColumnWidth(14, 100); // Unit Price
    sheet.setColumnWidth(15, 100); // Line Total
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
    var unitPrice = parseFloat(item.unitPrice || item.price) || 0;
    var qty = parseFloat(item.quantity) || 0;
    var lineTotal = parseFloat(item.lineTotal) || (unitPrice * qty);

    rows.push([
      timestamp,
      orderId,
      OFFER_NAME,
      item.warehouse || '',
      data.company || '',
      data.contact || '',
      data.email || '',
      data.phone || '',
      i === 0 ? (data.notes || '') : '',
      item.wine || '',
      item.producer || '',
      item.format || '',
      qty,
      unitPrice,
      lineTotal
    ]);
  }

  // Batch write
  if (rows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 15).setValues(rows);
  }

  // Format currency columns
  var lastRow = sheet.getLastRow();
  var startRow = lastRow - rows.length + 1;
  sheet.getRange(startRow, 14, rows.length, 2).setNumberFormat('$#,##0.00');
  sheet.getRange(startRow, 13, rows.length, 1).setNumberFormat('0.00');

  return {
    status: 'success',
    message: 'Order ' + orderId + ' received. Thank you!',
    orderId: orderId
  };
}

/* ── Helpers ── */
function generateOrderId_() {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var id = 'SRC-';
  for (var i = 0; i < 6; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

/* ── Test function (run from script editor) ── */
function testOrder() {
  var testData = {
    orderId: 'SRC-TEST01',
    company: 'Test Wine Shop',
    contact: 'Jane Doe',
    email: 'jane@test.com',
    phone: '555-0100',
    notes: 'Test order from portfolio',
    items: [
      { wine: '2022 Wechsler, Riesling, Trocken', producer: 'Katharina Wechsler', unitPrice: 216, quantity: 2, format: '12/750ml', warehouse: 'FDL' },
      { wine: '2020 Brandini, Barolo, La Morra', producer: 'Agricola Brandini', unitPrice: 528, quantity: 1, format: '12/750ml', warehouse: 'FDL' }
    ]
  };

  var result = processOrder(testData);
  Logger.log(result);
}
