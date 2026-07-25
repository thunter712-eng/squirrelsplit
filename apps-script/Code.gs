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
  People:   ["id", "name", "role", "emoji", "venmoUsername", "phone", "email", "linkedRoommateId", "isAdmin"],
  Utilities:["id", "name", "icon"],
  Charges:  ["id", "utilityId", "totalAmount", "dateAdded", "note", "participantIds"],
  Shares:   ["id", "chargeId", "personId", "amountOwed", "status", "paidDate"],
};

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

  writeConfig({ password: INITIAL_PASSWORD, houseName: "AGD House", reminderDay: 1, overdueDays: 10 });

  [["Rent", "🏠"], ["Power", "⚡"], ["Internet", "📶"], ["Water/Sewer", "💧"]].forEach(function (u) {
    appendRow("Utilities", { id: uid(), name: u[0], icon: u[1] });
  });
  SpreadsheetApp.getActive().toast("SquirrelSplit setup complete ✅");
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
      case "markPaid":     markPaid(body.personId); return ok();
      case "updateConfig": writeConfig(body.config); return ok();
      default: throw new Error("Unknown action: " + body.action);
    }
  } catch (err) {
    return json({ ok: false, error: String(err.message || err) });
  }
}

/* ---------------- domain logic ---------------- */
function getState() {
  return {
    config: readConfig(),
    people: readObjects("People"),
    utilities: readObjects("Utilities"),
    charges: readObjects("Charges"),
    shares: readObjects("Shares"),
  };
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

function markPaid(personId) {
  var shares = readObjects("Shares");
  var today = new Date().toISOString().slice(0, 10);
  shares.forEach(function (s) {
    if (s.personId === personId && s.status === "unpaid") { s.status = "paid"; s.paidDate = today; }
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
  if (now.getDate() !== Number(cfg.reminderDay)) return; // self-gates to the chosen day
  var st = getState();
  var admins = st.people.filter(function (p) { return p.isAdmin && p.venmoUsername; });
  var overdueDays = Number(cfg.overdueDays) || 10;

  st.people.filter(function (p) { return p.role === "roommate" && p.email; }).forEach(function (p) {
    var mine = st.shares.filter(function (s) { return s.personId === p.id && s.status === "unpaid"; });
    var total = mine.reduce(function (a, s) { return a + Number(s.amountOwed); }, 0);
    if (total <= 0) return;
    var rows = mine.map(function (s) {
      var c = byId(st.charges, s.chargeId); var u = byId(st.utilities, c.utilityId) || { name: "Bill", icon: "🧾" };
      var days = Math.floor((now - new Date(c.dateAdded + "T00:00:00")) / 86400000);
      var late = days > overdueDays ? " <b style='color:#A6192E'>(overdue)</b>" : "";
      return "<tr><td>" + u.icon + " " + u.name + late + "</td><td align='right'>$" + Number(s.amountOwed).toFixed(2) + "</td></tr>";
    }).join("");
    var pay = admins.map(function (a) {
      var link = "https://venmo.com/" + encodeURIComponent(a.venmoUsername) +
        "?txn=pay&amount=" + total.toFixed(2) + "&note=" + encodeURIComponent(cfg.houseName + " 🐿️");
      return "<a href='" + link + "' style='background:#008CFF;color:#fff;padding:10px 16px;border-radius:10px;text-decoration:none;display:inline-block;margin:4px'>Pay " + a.name + " @" + a.venmoUsername + "</a>";
    }).join("");
    var html =
      "<div style='font-family:sans-serif;max-width:460px'>" +
      "<h2 style='color:#A6192E'>🐿️ " + cfg.houseName + " — your share</h2>" +
      "<p>Hi " + p.name + "! Here's what you owe this month:</p>" +
      "<table style='width:100%;border-collapse:collapse'>" + rows +
      "<tr><td style='border-top:2px solid #A6192E;padding-top:6px'><b>Total</b></td>" +
      "<td align='right' style='border-top:2px solid #A6192E;padding-top:6px'><b>$" + total.toFixed(2) + "</b></td></tr></table>" +
      "<p style='margin-top:16px'>" + pay + "</p>" +
      "<p style='color:#8a7f72;font-size:12px'>Alpha Gamma Delta · Auburn 🦅 · sent by SquirrelSplit</p></div>";
    MailApp.sendEmail({ to: p.email, subject: "🐿️ " + cfg.houseName + ": you owe $" + total.toFixed(2), htmlBody: html });
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
  if (name === "People") o.isAdmin = (o.isAdmin === true || String(o.isAdmin).toLowerCase() === "true");
  if (name === "Charges") {
    o.totalAmount = Number(o.totalAmount) || 0;
    o.participantIds = o.participantIds ? String(o.participantIds).split(",").filter(String) : [];
    o.dateAdded = formatDate(o.dateAdded);
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
