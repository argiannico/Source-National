function doPost(e) {
  try {
    var lock = LockService.getScriptLock();
    lock.tryLock(10000);

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var data = JSON.parse(e.postData.contents);

    // --- ANALYTICS events go to "Analytics" sheet ---
    if (data.type === 'analytics') {
      var analyticsSheet = ss.getSheetByName('Analytics');
      if (!analyticsSheet) {
        analyticsSheet = ss.insertSheet('Analytics');
        var aHeaders = ['Timestamp', 'Event', 'Producer', 'Wine', 'Details', 'Session ID', 'User Agent', 'Referrer'];
        analyticsSheet.getRange(1, 1, 1, aHeaders.length).setValues([aHeaders]);
        analyticsSheet.getRange(1, 1, 1, aHeaders.length).setFontWeight('bold');
      }
      var events = data.events;
      for (var i = 0; i < events.length; i++) {
        var ev = events[i];
        analyticsSheet.appendRow([
          ev.timestamp || new Date().toISOString(),
          ev.event,
          ev.producer || '',
          ev.wine || '',
          ev.details || '',
          data.sessionId || '',
          data.userAgent || '',
          data.referrer || ''
        ]);
      }
      lock.releaseLock();
      return ContentService
        .createTextOutput(JSON.stringify({ result: 'success' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // --- ORDER data goes to first sheet ---
    var sheet = ss.getSheets()[0];

    var headers = ['Timestamp', 'Company', 'Contact', 'Email', 'Phone', 'Wine', 'Producer', 'Quantity', 'Unit Price (per case)', 'Line Total', 'Notes', 'Order ID'];
    if (sheet.getLastRow() === 0 || sheet.getRange(1, 1).getValue() !== 'Timestamp') {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    }

    var orderId = data.orderId;
    var timestamp = new Date().toISOString();
    var items = data.items;

    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var row = [
        timestamp,
        data.company,
        data.contact,
        data.email,
        data.phone,
        item.wine,
        item.producer,
        item.quantity,
        item.unitPrice,
        item.lineTotal,
        data.notes,
        orderId
      ];
      sheet.appendRow(row);
    }

    lock.releaseLock();

    return ContentService
      .createTextOutput(JSON.stringify({ result: 'success', orderId: orderId }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({ result: 'error', message: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ result: 'ready' }))
    .setMimeType(ContentService.MimeType.JSON);
}
