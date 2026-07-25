/*************************************************************
 * SquirrelSplit — Google Apps Script backend
 * -----------------------------------------------------------
 * HOW TO INSTALL (see README.md for the full walkthrough):
 *   1. Make a new Google Sheet.
 *   2. Extensions → Apps Script. Delete any sample code and
 *      paste THIS whole file in. Save.
 *   3. Change INITIAL_PASSWORD below to your house password.
 *   4. Run  setup()  once (authorize it when asked).
 *   5. Run  createDailyReminderTrigger()  once (for emails).
 *   6. Deploy → New deployment → type "Web app":
 *        Execute as: Me     Who has access: Anyone
 *      Copy the /exec URL into the website's config.js.
 *
 * You can change the password anytime by editing the value
 * cell next to "password" on the Config sheet.
 *************************************************************/

var INITIAL_PASSWORD = "auburn-agd-2026"; // <-- change me before running setup()

var TABS = {
  Config:   ["key", "value"],
  People:   ["id", "name", "role", "emoji", "venmoUsername", "phone", "email", "linkedRoommateId", "isAdmin", "rentAmount"],
  Utilities:["id", "name", "icon"],
  Charges:  ["id", "utilityId", "totalAmount", "dateAdded", "note", "participantIds", "kind", "period", "dueDate"],
  Shares:   ["id", "chargeId", "personId", "amountOwed", "status", "paidDate"],
  Receipts: ["id", "chargeId", "fileId", "viewUrl", "imgUrl", "uploadedBy", "uploadedAt", "caption"],
};

var DEFAULT_RENT_PORTAL = "https://two21armstrong.securecafe.com/residentservices/two21-armstrong-apartments-student/userlogin.aspx";
var DEFAULT_RENT_STEPS = "Log in, click Payments at the top of the screen, then select your name. You can also use the \"RentCafe Resident\" app on your phone.";

/* ---------------- one-time setup ---------------- */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(TABS).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    sh.clear();
    sh.getRange(1, 1, 1, TABS[name].length).setValues([TABS[name]]).setFontWeight("bold");
    sh.setFrozenRows(1);
  });
  var def = ss.getSheetByName("Sheet1");
  if (def && ss.getSheets().length > 1) ss.deleteSheet(def);

  var rentId = uid();
  [[rentId, "Rent", "🏠"]].concat([["Power", "⚡"], ["Internet", "📶"], ["Water/Sewer", "💧"]].map(function (u) {
    return [uid(), u[0], u[1]];
  })).forEach(function (u) {
    appendRow("Utilities", { id: u[0], name: u[1], icon: u[2] });
  });

  writeConfig({
    password: INITIAL_PASSWORD, houseName: "AGD House", reminderDay: 1, overdueDays: 10,
    rentUtilityId: rentId, rentDueDay: 1, rentPortalUrl: DEFAULT_RENT_PORTAL, rentInstructions: DEFAULT_RENT_STEPS,
  });
  SpreadsheetApp.getActive().toast("SquirrelSplit setup complete ✅");
}

/* Run this once after UPDATING the code, to add new columns/config without wiping data. */
function migrate() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(TABS).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) { sh = ss.insertSheet(name); sh.getRange(1, 1, 1, TABS[name].length).setValues([TABS[name]]).setFontWeight("bold"); sh.setFrozenRows(1); }
    else { overwrite(name, readObjects(name)); } // rewrites header row to new schema, preserves data
  });
  var cfg = readConfig();
  var patch = {};
  if (cfg.rentUtilityId == null || cfg.rentUtilityId === "") {
    var rent = readObjects("Utilities").filter(function (u) { return u.name === "Rent"; })[0];
    if (rent) patch.rentUtilityId = rent.id;
  }
  if (cfg.rentDueDay == null || cfg.rentDueDay === "") patch.rentDueDay = 1;
  if (!cfg.rentPortalUrl) patch.rentPortalUrl = DEFAULT_RENT_PORTAL;
  if (!cfg.rentInstructions) patch.rentInstructions = DEFAULT_RENT_STEPS;
  if (Object.keys(patch).length) writeConfig(patch);
  ensureReceiptsFolder(); // touches Drive so this run prompts for the photo-upload permission
  SpreadsheetApp.getActive().toast("Migration complete ✅ — rent + photo uploads ready");
}

function createDailyReminderTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "sendMonthlyReminders") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("sendMonthlyReminders").timeBased().everyDays(1).atHour(9).create();
}

/* ---------------- web entrypoints ---------------- */
function doGet(e) {
  if (e && e.parameter && e.parameter.action) return handle(e.parameter);
  return json({ ok: true, msg: "SquirrelSplit backend is running 🐿️" });
}
function doPost(e) {
  var body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) {}
  return handle(body);
}

function handle(body) {
  try {
    var cfg = readConfig();
    if (body.action === "login") {
      if (String(body.password) !== String(cfg.password)) throw new Error("Wrong password");
      return json({ ok: true });
    }
    if (String(body.password) !== String(cfg.password)) throw new Error("Wrong password");

    switch (body.action) {
      case "getState":     return json({ ok: true, state: getState() });
      case "upsertPerson": upsert("People", body.person); return ok();
      case "deletePerson": remove("People", body.id); return ok();
      case "addUtility":   appendRow("Utilities", body.utility); return ok();
      case "deleteUtility":remove("Utilities", body.id); return ok();
      case "addCharge":    addCharge(body.charge); return ok();
      case "deleteCharge": deleteCharge(body.chargeId); return ok();
      case "markPaid":     markPaid(body.personId, body.scope); return ok();
      case "addReceipt":   return json({ ok: true, receipt: addReceipt(body) });
      case "deleteReceipt":deleteReceipt(body.id); return ok();
      case "updateConfig": writeConfig(body.config); return ok();
      default: throw new Error("Unknown action: " + body.action);
    }
  } catch (err) {
    return json({ ok: false, error: String(err.message || err) });
  }
}

/* ---------------- domain logic ---------------- */
function getState() {
  ensureRentForMonth(); // auto-create/reconcile this month's rent before returning
  return {
    config: readConfig(),
    people: readObjects("People"),
    utilities: readObjects("Utilities"),
    charges: readObjects("Charges"),
    shares: readObjects("Shares"),
    receipts: readObjects("Receipts"),
  };
}

/* ---------------- receipts (bill photos) stored in Google Drive ---------------- */
function ensureReceiptsFolder() {
  var cfg = readConfig();
  if (cfg.receiptsFolderId) {
    try { return DriveApp.getFolderById(cfg.receiptsFolderId); } catch (e) {}
  }
  var f = DriveApp.createFolder("SquirrelSplit Receipts");
  writeConfig({ receiptsFolderId: f.getId() });
  return f;
}

function addReceipt(r) {
  var m = /^data:(image\/[a-zA-Z]+);base64,(.*)$/.exec(r.dataUrl || "");
  if (!m) throw new Error("Bad image data");
  var ext = (m[1].split("/")[1] || "jpg").toLowerCase();
  var blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], "receipt-" + Date.now() + "." + ext);
  var file = ensureReceiptsFolder().createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  var id = file.getId();
  var rec = {
    id: uid(), chargeId: String(r.chargeId), fileId: id,
    viewUrl: "https://drive.google.com/file/d/" + id + "/view",
    imgUrl: "https://drive.google.com/thumbnail?id=" + id + "&sz=w600",
    uploadedBy: r.uploadedBy || "", uploadedAt: new Date().toISOString().slice(0, 10),
    caption: r.caption || "",
  };
  appendRow("Receipts", rec);
  return rec;
}

function deleteReceipt(id) {
  var recs = readObjects("Receipts");
  var r = recs.filter(function (x) { return String(x.id) === String(id); })[0];
  if (r && r.fileId) { try { DriveApp.getFileById(r.fileId).setTrashed(true); } catch (e) {} }
  overwrite("Receipts", recs.filter(function (x) { return String(x.id) !== String(id); }));
}

function pad2(n) { return (n < 10 ? "0" : "") + n; }
function ymOf(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1); }

/* Rent is per-person (each roommate has their own rentAmount), auto-recurring monthly,
   paid via the RentCafe portal — NOT split evenly and NOT paid by Venmo. */
function ensureRentForMonth() {
  var cfg = readConfig();
  var rentUtilId = String(cfg.rentUtilityId || "");
  var period = ymOf(new Date());
  var people = readObjects("People");
  var renters = people.filter(function (p) { return p.role === "roommate" && Number(p.rentAmount) > 0; });
  if (!renters.length) return;

  var charges = readObjects("Charges");
  var shares = readObjects("Shares");
  var dueDay = Math.min(Math.max(Number(cfg.rentDueDay) || 1, 1), 28);
  var dueDate = period + "-" + pad2(dueDay);

  var rc = charges.filter(function (c) { return c.kind === "rent" && c.period === period; })[0];
  var changedC = false, changedS = false;
  if (!rc) {
    rc = { id: uid(), utilityId: rentUtilId, totalAmount: 0, dateAdded: period + "-01",
           note: "Rent " + period, participantIds: [], kind: "rent", period: period, dueDate: dueDate };
    charges.push(rc); changedC = true;
  } else if (rc.dueDate !== dueDate) { rc.dueDate = dueDate; changedC = true; }

  var byPerson = {};
  shares.forEach(function (s) { if (s.chargeId === rc.id) byPerson[s.personId] = s; });
  var wantIds = renters.map(function (p) { return String(p.id); });

  renters.forEach(function (p) {
    var s = byPerson[String(p.id)];
    if (s) {
      if (s.status === "unpaid" && Number(s.amountOwed) !== Number(p.rentAmount)) { s.amountOwed = Number(p.rentAmount); changedS = true; }
    } else {
      shares.push({ id: uid(), chargeId: rc.id, personId: String(p.id), amountOwed: Number(p.rentAmount), status: "unpaid", paidDate: "" });
      changedS = true;
    }
  });
  // drop UNPAID rent shares for people no longer charged (keep paid ones as history)
  var newShares = shares.filter(function (s) {
    if (s.chargeId !== rc.id) return true;
    if (wantIds.indexOf(String(s.personId)) >= 0) return true;
    if (s.status === "paid") return true;
    changedS = true; return false;
  });

  var total = renters.reduce(function (a, p) { return a + Number(p.rentAmount); }, 0);
  if (Number(rc.totalAmount) !== total) { rc.totalAmount = total; changedC = true; }
  if ((rc.participantIds || []).join(",") !== wantIds.join(",")) { rc.participantIds = wantIds; changedC = true; }

  if (changedC) overwrite("Charges", charges);
  if (changedS) overwrite("Shares", newShares);
}

function addCharge(charge) {
  charge.id = uid();
  var parts = charge.participantIds || [];
  appendRow("Charges", {
    id: charge.id, utilityId: charge.utilityId, totalAmount: charge.totalAmount,
    dateAdded: charge.dateAdded, note: charge.note || "", participantIds: parts.join(","),
  });
  var amts = splitAmount(charge.totalAmount, parts.length);
  parts.forEach(function (pid, i) {
    appendRow("Shares", { id: uid(), chargeId: charge.id, personId: pid, amountOwed: amts[i], status: "unpaid", paidDate: "" });
  });
}

function deleteCharge(chargeId) {
  remove("Charges", chargeId);
  var shares = readObjects("Shares").filter(function (s) { return s.chargeId !== chargeId; });
  overwrite("Shares", shares);
}

// scope: "rent" = only rent shares, "venmo" = only non-rent, undefined = all
function markPaid(personId, scope) {
  var shares = readObjects("Shares");
  var rentIds = readObjects("Charges").filter(function (c) { return c.kind === "rent"; })
    .map(function (c) { return String(c.id); });
  var today = new Date().toISOString().slice(0, 10);
  shares.forEach(function (s) {
    if (String(s.personId) !== String(personId) || s.status !== "unpaid") return;
    var isRent = rentIds.indexOf(String(s.chargeId)) >= 0;
    if (scope === "rent" && !isRent) return;
    if (scope === "venmo" && isRent) return;
    s.status = "paid"; s.paidDate = today;
  });
  overwrite("Shares", shares);
}

function splitAmount(total, n) {
  var cents = Math.round(total * 100), base = Math.floor(cents / n), rem = cents - base * n, out = [];
  for (var i = 0; i < n; i++) out.push((base + (i < rem ? 1 : 0)) / 100);
  return out;
}

/* ---------------- monthly email reminders ---------------- */
function sendMonthlyReminders() {
  var cfg = readConfig();
  var now = new Date();
  ensureRentForMonth(); // runs daily so each new month's rent appears even if nobody opens the app
  if (now.getDate() !== Number(cfg.reminderDay)) return; // self-gates the EMAIL to the chosen day
  var st = getState();
  var admins = st.people.filter(function (p) { return p.isAdmin && p.venmoUsername; });
  var overdueDays = Number(cfg.overdueDays) || 10;
  var today = now.toISOString().slice(0, 10);
  var rentIds = {};
  st.charges.forEach(function (c) { if (c.kind === "rent") rentIds[String(c.id)] = c; });

  function lateTag(c) {
    if (c.dueDate) return today > c.dueDate ? " <b style='color:#A6192E'>(overdue)</b>" : "";
    var days = Math.floor((now - new Date(c.dateAdded + "T00:00:00")) / 86400000);
    return days > overdueDays ? " <b style='color:#A6192E'>(overdue)</b>" : "";
  }

  st.people.filter(function (p) { return p.role === "roommate" && p.email; }).forEach(function (p) {
    var mine = st.shares.filter(function (s) { return s.personId === p.id && s.status === "unpaid"; });
    var rentTotal = 0, venmoTotal = 0, rentRows = "", venmoRows = "";
    mine.forEach(function (s) {
      var c = byId(st.charges, s.chargeId); if (!c) return;
      var u = byId(st.utilities, c.utilityId) || { name: "Bill", icon: "🧾" };
      var row = "<tr><td>" + u.icon + " " + u.name + lateTag(c) + "</td><td align='right'>$" + Number(s.amountOwed).toFixed(2) + "</td></tr>";
      if (rentIds[String(s.chargeId)]) { rentTotal += Number(s.amountOwed); rentRows += row; }
      else { venmoTotal += Number(s.amountOwed); venmoRows += row; }
    });
    if (rentTotal + venmoTotal <= 0) return;

    var utilBlock = venmoTotal > 0 ?
      "<h3 style='margin:18px 0 4px;color:#A6192E'>Utilities — $" + venmoTotal.toFixed(2) + " (Venmo)</h3>" +
      "<table style='width:100%;border-collapse:collapse'>" + venmoRows + "</table>" +
      "<p style='margin:8px 0'>" + admins.map(function (a) {
        var link = "https://venmo.com/" + encodeURIComponent(a.venmoUsername) +
          "?txn=pay&amount=" + venmoTotal.toFixed(2) + "&note=" + encodeURIComponent(cfg.houseName + " utilities 🐿️");
        return "<a href='" + link + "' style='background:#008CFF;color:#fff;padding:10px 16px;border-radius:10px;text-decoration:none;display:inline-block;margin:4px'>Pay " + a.name + " @" + a.venmoUsername + "</a>";
      }).join("") + "</p>" : "";

    var rentBlock = rentTotal > 0 ?
      "<h3 style='margin:18px 0 4px;color:#A6192E'>🏠 Rent — $" + rentTotal.toFixed(2) + "</h3>" +
      "<table style='width:100%;border-collapse:collapse'>" + rentRows + "</table>" +
      "<p style='margin:8px 0'><a href='" + (cfg.rentPortalUrl || DEFAULT_RENT_PORTAL) +
      "' style='background:#2E7D51;color:#fff;padding:10px 16px;border-radius:10px;text-decoration:none;display:inline-block'>Pay rent at 221 Armstrong ↗</a></p>" +
      "<p style='color:#5a5148;font-size:13px'>" + (cfg.rentInstructions || DEFAULT_RENT_STEPS) + "</p>" : "";

    var grand = rentTotal + venmoTotal;
    var html =
      "<div style='font-family:sans-serif;max-width:460px'>" +
      "<h2 style='color:#A6192E'>🐿️ " + cfg.houseName + " — your share this month</h2>" +
      "<p>Hi " + p.name + "! Here's what's due:</p>" + utilBlock + rentBlock +
      "<p style='color:#8a7f72;font-size:12px;margin-top:18px'>Alpha Gamma Delta · Auburn 🦅 · sent by SquirrelSplit</p></div>";
    MailApp.sendEmail({ to: p.email, subject: "🐿️ " + cfg.houseName + ": $" + grand.toFixed(2) + " due this month", htmlBody: html });
  });
}

/* ---------------- sheet helpers ---------------- */
function sheet(name) { return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name); }
function headers(name) { return TABS[name]; }

function readObjects(name) {
  var sh = sheet(name);
  var values = sh.getDataRange().getValues();
  var hdr = values.shift() || [];
  return values.filter(function (r) { return r.join("") !== ""; }).map(function (r) {
    var o = {};
    hdr.forEach(function (h, i) { o[h] = r[i]; });
    return coerce(name, o);
  });
}

function coerce(name, o) {
  if (name === "People") {
    o.isAdmin = (o.isAdmin === true || String(o.isAdmin).toLowerCase() === "true");
    o.rentAmount = Number(o.rentAmount) || 0;
  }
  if (name === "Charges") {
    o.totalAmount = Number(o.totalAmount) || 0;
    o.participantIds = o.participantIds ? String(o.participantIds).split(",").filter(String) : [];
    o.dateAdded = formatDate(o.dateAdded);
    o.kind = String(o.kind || "");
    o.period = String(o.period || "");
    o.dueDate = o.dueDate ? formatDate(o.dueDate) : "";
  }
  if (name === "Shares") o.amountOwed = Number(o.amountOwed) || 0;
  ["id", "chargeId", "personId", "linkedRoommateId"].forEach(function (k) {
    if (o[k] != null) o[k] = String(o[k]);
  });
  return o;
}

function formatDate(v) {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v || "").slice(0, 10);
}

function rowFor(name, obj) {
  return headers(name).map(function (h) {
    var v = obj[h];
    if (Array.isArray(v)) return v.join(",");
    return v == null ? "" : v;
  });
}

function appendRow(name, obj) {
  if (!obj.id) obj.id = uid();
  sheet(name).appendRow(rowFor(name, obj));
}

function overwrite(name, objects) {
  var sh = sheet(name);
  sh.clear();
  sh.getRange(1, 1, 1, headers(name).length).setValues([headers(name)]).setFontWeight("bold");
  if (objects.length) {
    sh.getRange(2, 1, objects.length, headers(name).length)
      .setValues(objects.map(function (o) { return rowFor(name, o); }));
  }
  sh.setFrozenRows(1);
}

function upsert(name, obj) {
  var all = readObjects(name);
  var i = all.findIndex(function (x) { return String(x.id) === String(obj.id); });
  if (i >= 0) all[i] = obj; else all.push(obj);
  overwrite(name, all);
}

function remove(name, id) {
  overwrite(name, readObjects(name).filter(function (x) { return String(x.id) !== String(id); }));
}

function readConfig() {
  var o = {};
  readObjects("Config").forEach(function (r) { o[r.key] = r.value; });
  o.reminderDay = Number(o.reminderDay) || 1;
  o.overdueDays = Number(o.overdueDays) || 10;
  return o;
}

function writeConfig(patch) {
  var cur = {};
  readObjects("Config").forEach(function (r) { cur[r.key] = r.value; });
  Object.keys(patch).forEach(function (k) { cur[k] = patch[k]; });
  var rows = Object.keys(cur).map(function (k) { return { key: k, value: cur[k] }; });
  overwrite("Config", rows);
}

/* ---------------- misc ---------------- */
function byId(arr, id) { return arr.filter(function (x) { return String(x.id) === String(id); })[0]; }
function uid() { return "id" + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36); }
function ok() { return json({ ok: true }); }
function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
