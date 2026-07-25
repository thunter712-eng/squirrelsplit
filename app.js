/* ============================================================
   SquirrelSplit — client app
   Talks to a Google Apps Script backend, OR runs a local DEMO
   backend (config.js apiUrl === "DEMO") using localStorage.
   ============================================================ */
(function () {
  "use strict";

  var CFG = window.SQUIRREL_CONFIG || {};
  var API_URL = CFG.apiUrl || "DEMO";
  var DEMO = API_URL === "DEMO" || !API_URL;

  var EMOJIS = ["🐿️","🌰","🌹","🦋","🌸","🌻","👑","🎀","💛","💚","❤️","⭐","✨","🍂","🦉","🐻","🐶","🐱","🦊","🐰","🐨","🦅","🔥","🌟"];

  // Auburn haikus (5-7-5) shown when a bill is squared away
  var HAIKUS = [
    ["War Eagle takes flight", "circling over Jordan-Hare", "the Plains roar as one"],
    ["Toomer's oaks are rolled", "white streamers in evening light", "another sweet win"],
    ["Toomer's lemonade", "golden, cold, and Auburn sweet", "sip beneath the oaks"],
    ["Aubie leads the crowd", "orange and blue everywhere", "the Tigers are home"],
    ["Tiger Walk begins", "thousands cheer the marching team", "down to Jordan-Hare"],
    ["Iron Bowl showdown", "the whole state holds its breath now", "War Eagle prevails"],
    ["Samford's clock tower", "chimes across the loveliest", "village on the Plains"],
    ["Orange sunset glows", "over Auburn's rolling hills", "home sweet Auburn home"],
    ["War Eagle rings out", "the Tigers take the field now", "Jordan-Hare erupts"],
    ["Fall on the Plains now", "crisp air, cowbells, and kickoff", "all is right today"],
    ["Bills split, squirrels fed", "Toomer's rolled in victory", "Auburn hearts are full"],
    ["Eagle in the sky", "spirals down to thunderous", "War Eagle applause"],
  ];
  function randomHaikuHTML() {
    var h = HAIKUS[Math.floor(Math.random() * HAIKUS.length)];
    return '<div class="haiku">🦅<br>' + h.map(esc).join("<br>") + "</div>";
  }

  // ---- persistent client keys ----
  var K_PW = "ss_pw";
  var K_ME = "ss_me";

  var STATE = null;   // {config, people, utilities, charges, shares}
  var PW = localStorage.getItem(K_PW) || "";

  // ---------- tiny helpers ----------
  var $ = function (s, r) { return (r || document).querySelector(s); };
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function money(x) { return "$" + (Math.round(x * 100) / 100).toFixed(2); }
  function todayISO() { return new Date().toISOString().slice(0, 10); }
  function uid() { return "id" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function daysBetween(iso) {
    var d = new Date(iso + "T00:00:00");
    return Math.floor((Date.now() - d.getTime()) / 86400000);
  }

  // ---------- API ----------
  async function api(action, payload) {
    payload = payload || {};
    if (DEMO) return demoApi(action, payload);
    var res = await fetch(API_URL, {
      method: "POST",
      // text/plain keeps it a "simple" request (no CORS preflight the endpoint can't answer)
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(Object.assign({ action: action, password: PW }, payload)),
    });
    var data = await res.json();
    if (!data.ok) throw new Error(data.error || "Something went wrong");
    return data;
  }

  // ---------- split math (mirrors backend) ----------
  function splitAmount(total, n) {
    var cents = Math.round(total * 100);
    var base = Math.floor(cents / n);
    var rem = cents - base * n;
    var out = [];
    for (var i = 0; i < n; i++) out.push((base + (i < rem ? 1 : 0)) / 100);
    return out;
  }

  // ---------- derived lookups ----------
  function personById(id) { return STATE.people.find(function (p) { return p.id === id; }); }
  function utilById(id) { return STATE.utilities.find(function (u) { return u.id === id; }) || { name: "Bill", icon: "🧾" }; }
  function chargeById(id) { return STATE.charges.find(function (c) { return c.id === id; }); }
  function roommates() { return STATE.people.filter(function (p) { return p.role === "roommate"; }); }
  function payTargets() { return STATE.people.filter(function (p) { return p.isAdmin && p.venmoUsername; }); }
  function sharesOf(pid) { return STATE.shares.filter(function (s) { return s.personId === pid; }); }
  function isRentCharge(c) { return c && (c.kind === "rent" || String(c.utilityId) === String(STATE.config.rentUtilityId)); }
  function isRentShare(s) { return isRentCharge(chargeById(s.chargeId)); }
  function balanceOf(pid) {
    return sharesOf(pid).reduce(function (sum, s) { return s.status === "unpaid" ? sum + s.amountOwed : sum; }, 0);
  }
  // rent (portal) vs venmo (splittable utilities) portions of what someone owes
  function rentDue(pid) {
    return sharesOf(pid).reduce(function (sum, s) { return (s.status === "unpaid" && isRentShare(s)) ? sum + s.amountOwed : sum; }, 0);
  }
  function venmoDue(pid) {
    return sharesOf(pid).reduce(function (sum, s) { return (s.status === "unpaid" && !isRentShare(s)) ? sum + s.amountOwed : sum; }, 0);
  }
  function shareOverdue(s) {
    if (s.status !== "unpaid") return false;
    var c = chargeById(s.chargeId);
    if (!c) return false;
    if (c.dueDate) return todayISO() > c.dueDate;               // rent uses its due date
    return daysBetween(c.dateAdded) > (STATE.config.overdueDays || 10);
  }
  function personOverdue(pid) { return sharesOf(pid).some(shareOverdue); }

  // ---------- link builders ----------
  function venmoLink(username, amount, note) {
    return "https://venmo.com/" + encodeURIComponent(username) +
      "?txn=pay&amount=" + amount.toFixed(2) + "&note=" + encodeURIComponent(note);
  }
  function venmoProfileLink(username) {
    return "https://venmo.com/u/" + encodeURIComponent(username);
  }
  // "verify recipient(s)" line shown under Pay buttons
  function verifyLineHTML(targets) {
    var t = (targets || payTargets()).filter(function (a) { return a.venmoUsername; });
    if (!t.length) return "";
    return '<div class="verifyline">Paying the right person? ' +
      t.map(function (a) {
        return '<a href="' + esc(venmoProfileLink(a.venmoUsername)) +
          '" target="_blank" rel="noopener">✓ check @' + esc(a.venmoUsername) + " ↗</a>";
      }).join(" · ") + "</div>";
  }
  // ---------- receipts (bill photos) ----------
  function receiptsFor(chargeId) {
    return (STATE.receipts || []).filter(function (r) { return String(r.chargeId) === String(chargeId); });
  }
  function receiptsHTML(chargeId, isAdmin) {
    var rs = receiptsFor(chargeId);
    var thumbs = rs.map(function (r) {
      return '<div class="receipt" data-act="viewreceipt" data-url="' + esc(r.viewUrl || r.imgUrl) + '">' +
        '<img src="' + esc(r.imgUrl) + '" loading="lazy" alt="receipt">' +
        (r.uploadedBy ? '<span class="rby">' + esc(r.uploadedBy) + "</span>" : "") +
        (isAdmin ? '<button class="rmreceipt" data-act="delreceipt" data-id="' + esc(r.id) + '">✕</button>' : "") +
        "</div>";
    }).join("");
    return '<div class="receipts">' + thumbs +
      '<button class="addphoto" data-act="addphoto" data-id="' + chargeId + '">📸 Add proof</button></div>';
  }
  // shrink a chosen image to a data URL so uploads stay small
  function fileToDataUrl(file, maxDim, quality) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () {
        var scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        var w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
        var cv = document.createElement("canvas"); cv.width = w; cv.height = h;
        cv.getContext("2d").drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        try { resolve(cv.toDataURL("image/jpeg", quality)); } catch (e) { reject(e); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("Could not read that image")); };
      img.src = url;
    });
  }
  function pickReceipt(chargeId, trigger) {
    var input = document.createElement("input");
    input.type = "file"; input.accept = "image/*";
    input.onchange = async function () {
      var file = input.files && input.files[0];
      if (!file) return;
      if (trigger) { trigger.textContent = "⏳ Uploading…"; trigger.disabled = true; }
      try {
        var dataUrl = await fileToDataUrl(file, 1400, 0.7);
        var me = personById(localStorage.getItem(K_ME)) || {};
        await api("addReceipt", { chargeId: chargeId, dataUrl: dataUrl, uploadedBy: me.name || "" });
        await refresh();
      } catch (e) {
        alert("Upload failed: " + e.message);
        if (trigger) { trigger.textContent = "📸 Add proof"; trigger.disabled = false; }
      }
    };
    input.click();
  }

  function nudgeLink(person) {
    var amt = balanceOf(person.id);
    var admin = payTargets()[0];
    var vm = admin ? " Venmo @" + admin.venmoUsername : "";
    var body = "Hey " + person.name + "! 🐿️ Your AGD house share is " + money(amt) + "." + vm + " when you get a sec 💕";
    var num = String(person.phone || "").replace(/[^\d+]/g, "");
    return "sms:" + num + "&body=" + encodeURIComponent(body);
  }

  // ================= RENDER =================
  var main = $("#main");

  function render() {
    $("#houseName").textContent = STATE.config.houseName || "AGD House";
    if (STATE.people.length === 0) return renderBootstrap();
    var me = personById(localStorage.getItem(K_ME));
    if (!me) return renderWhoAreYou();
    $("#settingsBtn").classList.toggle("hidden", !me.isAdmin);
    renderDashboard(me);
  }

  // ---- first-run: create the first admin ----
  function renderBootstrap() {
    $("#settingsBtn").classList.add("hidden");
    main.innerHTML =
      '<div class="card"><h2>Welcome! 🐿️</h2>' +
      "<p>Let's set up your house. First, add yourself as the <b>admin</b> " +
      "(the parent who enters the bills).</p>" +
      personFormHTML({ role: "parent", isAdmin: true, emoji: "🦅" }, true) +
      "</div>";
    wirePersonForm(true);
  }

  // ---- who are you picker (grouped by family: roommate + their parents) ----
  function pickTile(p, cls) {
    return '<button class="picktile ' + (cls || "") + '" data-act="pickme" data-id="' + p.id + '">' +
      '<span class="em">' + esc(p.emoji || "🐿️") + "</span>" +
      esc(p.name) + '<div class="rl">' + (p.role === "roommate" ? "🐿️ roommate" : "parent") + "</div></button>";
  }
  function renderWhoAreYou() {
    $("#settingsBtn").classList.add("hidden");
    var claimed = {};
    var families = roommates().map(function (r) {
      var parents = STATE.people.filter(function (p) {
        return p.role === "parent" && String(p.linkedRoommateId) === String(r.id);
      });
      parents.forEach(function (p) { claimed[p.id] = 1; });
      return '<div class="family">' + pickTile(r, "head") +
        (parents.length
          ? '<div class="fam-parents"><div class="fam-label">👪 ' + esc(r.name) + "'s parent" + (parents.length > 1 ? "s" : "") + "</div>" +
            '<div class="picker">' + parents.map(function (p) { return pickTile(p); }).join("") + "</div></div>"
          : "") +
        "</div>";
    }).join("");
    var others = STATE.people.filter(function (p) { return p.role !== "roommate" && !claimed[p.id]; });
    var othersBlock = others.length
      ? '<div class="section-title" style="margin-top:16px">Parents &amp; others</div><div class="picker">' +
        others.map(function (p) { return pickTile(p); }).join("") + "</div>"
      : "";
    main.innerHTML =
      '<div class="card"><h2>Who are you?</h2>' +
      '<p class="tiny">Tap your name. Parents are grouped under their daughter.</p>' +
      (families || '<div class="empty"><div class="em">🐿️</div>No roommates yet.</div>') +
      othersBlock + "</div>";
  }

  // ---- main dashboard ----
  function renderDashboard(me) {
    var html = "";

    if (me.role === "roommate") {
      html += youCardHTML(me);
    } else {
      // parent: spotlight their linked daughter
      var kid = personById(me.linkedRoommateId);
      if (kid) html += spotlightHTML(me, kid);
    }

    if (me.isAdmin) html += adminToolbarHTML();

    // house list
    html += '<div class="section-title">The house 🏡</div><div class="card">';
    var rms = roommates();
    if (rms.length === 0) {
      html += '<div class="empty"><div class="em">🐿️</div>No roommates yet. Add them below!</div>';
    } else {
      html += rms.map(function (p) { return houseRowHTML(p, me); }).join("");
    }
    html += "</div>";

    // recent bills — each can carry photo proof anyone can view
    if (STATE.charges.length) {
      html += '<div class="section-title">Recent bills 📸</div><div class="card">';
      html += STATE.charges.slice().sort(function (a, b) { return a.dateAdded < b.dateAdded ? 1 : -1; })
        .slice(0, 12).map(function (c) {
          var u = utilById(c.utilityId);
          var n = STATE.shares.filter(function (s) { return s.chargeId === c.id; }).length;
          var split = isRentCharge(c) ? "per-person" : "split " + n + " ways";
          return '<div class="bill"><div class="charge"><span class="ic">' + esc(u.icon) + "</span>" +
            '<span class="nm">' + esc(u.name) + '<div class="tiny">' + esc(c.dateAdded) +
            " · " + split + (c.note ? " · " + esc(c.note) : "") + "</div></span>" +
            '<span class="amt">' + money(c.totalAmount) + "</span>" +
            (me.isAdmin ? ' <button class="linkbtn" data-act="delcharge" data-id="' + c.id + '">✕</button>' : "") +
            "</div>" + receiptsHTML(c.id, me.isAdmin) + "</div>";
        }).join("");
      html += "</div>";
    }

    main.innerHTML = html;
    if (me.isAdmin) {
      main.insertAdjacentHTML("beforeend",
        '<button class="fab" data-act="addbill">➕ Add a bill</button>');
    }
  }

  function statusPill(pid) {
    var bal = balanceOf(pid);
    if (bal <= 0.004) return '<span class="pill paid">✅ Paid up</span>';
    if (personOverdue(pid)) return '<span class="pill overdue">🔴 Overdue</span>';
    return '<span class="pill pending">🟡 ' + money(bal) + "</span>";
  }

  function chargeRowsHTML(pid) {
    return sharesOf(pid).map(function (s) {
      var c = chargeById(s.chargeId); var u = utilById(c.utilityId);
      var od = shareOverdue(s);
      var cls = s.status === "paid" ? "paid" : (od ? "overdue" : "");
      return '<div class="charge ' + cls + '"><span class="ic">' + esc(u.icon) + "</span>" +
        '<span class="nm">' + esc(u.name) + (od ? " · overdue" : "") + "</span>" +
        '<span class="amt">' + (s.status === "paid" ? "✅" : money(s.amountOwed)) + "</span></div>";
    }).join("");
  }

  // Venmo section for the splittable utilities (power/internet/etc.)
  function venmoSectionHTML(pid, amount, note, payees, markLabel) {
    if (amount <= 0.004) return "";
    var pay = payees.map(function (a, i) {
      return '<a class="btn ' + (i === 0 ? "venmo" : "ghost") + '" href="' +
        esc(venmoLink(a.venmoUsername, amount, note)) + '" target="_blank" rel="noopener">' +
        (i === 0 ? "💸 " : "") + "Pay " + esc(a.name) + " @" + esc(a.venmoUsername) + "</a>";
    }).join("");
    return '<div class="paysec"><div class="paylabel">💡 Utilities · ' + money(amount) + " (Venmo)</div>" +
      '<div class="btnrow" style="flex-direction:column">' + pay + "</div>" +
      verifyLineHTML(payees) +
      '<button class="btn primary" style="margin-top:10px" data-act="ipaid" data-id="' + pid + '">' + markLabel + "</button></div>";
  }

  // Rent section — paid at the 221 Armstrong RentCafe portal, NOT Venmo
  function rentSectionHTML(pid, amount) {
    if (amount <= 0.004) return "";
    var cfg = STATE.config;
    var url = cfg.rentPortalUrl || "";
    var steps = cfg.rentInstructions || "Log in, click Payments at the top of the screen, then select your name.";
    return '<div class="rentblock"><div class="paylabel">🏠 Rent · ' + money(amount) + "</div>" +
      (url ? '<a class="btn rent" href="' + esc(url) + '" target="_blank" rel="noopener">🏠 Pay rent at 221 Armstrong ↗</a>' : "") +
      '<div class="rentsteps">📱 Or use the <b>RentCafe Resident</b> app.<br>' + esc(steps) + "</div>" +
      '<button class="btn ghost sm" style="width:100%;margin-top:8px" data-act="paidrent" data-id="' + pid + '">✓ I paid rent — mark it</button></div>';
  }

  function utilNote(pid, label) {
    var names = sharesOf(pid).filter(function (s) { return s.status === "unpaid" && !isRentShare(s); })
      .map(function (s) { return utilById(chargeById(s.chargeId).utilityId).name; })
      .filter(function (v, i, a) { return a.indexOf(v) === i; });
    return label + ": " + names.join(", ") + " 🐿️";
  }

  function youCardHTML(me) {
    var rentAmt = rentDue(me.id), venmoAmt = venmoDue(me.id), bal = rentAmt + venmoAmt;
    var overdue = personOverdue(me.id);
    var paidUp = bal <= 0.004;
    var markLabel = rentAmt > 0.004 ? "🎉 I paid the utilities" : "🎉 I paid it — mark me square";

    return '<div class="card you ' + (overdue ? "overdue" : "") + '" id="youCard">' +
      '<div class="youtop"><div class="avatar bigavatar mascot">' + esc(me.emoji || "🐿️") + "</div>" +
      "<div><h2>Hi " + esc(me.name) + "!</h2>" +
      '<div class="tiny">' + (paidUp ? "You're all squared away 💚" : "Here's what you owe") + "</div></div>" +
      '<button class="iconbtn" style="background:var(--buff);color:var(--ink)" data-act="editprofile">✏️</button></div>' +
      '<div class="balance ' + (paidUp ? "zero" : "due") + '">' + money(bal) + "</div>" +
      (paidUp
        ? randomHaikuHTML()
        : '<div class="caption">' + sharesOf(me.id).filter(function (s) { return s.status === "unpaid"; }).length + " unpaid item(s)</div>") +
      (overdue ? '<div class="overdue-banner">🐿️💧 aww, a little past due — no worries, just tap pay!</div>' : "") +
      (chargeRowsHTML(me.id) ? "<div>" + chargeRowsHTML(me.id) + "</div>" : "") +
      (paidUp ? "" : venmoSectionHTML(me.id, venmoAmt, utilNote(me.id, "AGD utilities"), payTargets(), markLabel)) +
      (paidUp ? "" : rentSectionHTML(me.id, rentAmt)) +
      "</div>";
  }

  function spotlightHTML(parent, kid) {
    var rentAmt = rentDue(kid.id), venmoAmt = venmoDue(kid.id), bal = rentAmt + venmoAmt;
    var paidUp = bal <= 0.004;
    var payees = payTargets().filter(function (a) { return a.id !== parent.id; });
    var markLabel = rentAmt > 0.004 ? "🎉 Mark utilities paid" : "Mark " + esc(kid.name) + " paid";
    return '<div class="card spotlight"><div class="youtop">' +
      '<div class="avatar bigavatar">' + esc(kid.emoji || "🐿️") + "</div>" +
      "<div><h2>⭐ " + esc(kid.name) + "</h2><div class='tiny'>Your daughter's share</div></div>" +
      '<button class="iconbtn" style="background:var(--buff);color:var(--ink)" data-act="editprofile">✏️</button></div>' +
      '<div class="balance ' + (paidUp ? "zero" : "due") + '">' + money(bal) + "</div>" +
      (paidUp ? '<div class="caption">All paid up — thank you! 💚</div>' + randomHaikuHTML()
        : '<div class="caption">Owed this month</div>' +
          (chargeRowsHTML(kid.id) ? "<div>" + chargeRowsHTML(kid.id) + "</div>" : "") +
          venmoSectionHTML(kid.id, venmoAmt, "AGD utilities (" + kid.name + ") 🐿️", payees, markLabel) +
          rentSectionHTML(kid.id, rentAmt)) +
      "</div>";
  }

  function houseRowHTML(p, me) {
    var isMe = p.id === me.id;
    return '<div class="person">' +
      '<div class="avatar mascot">' + esc(p.emoji || "🐿️") + "</div>" +
      '<div class="who"><div class="name">' + esc(p.name) + (isMe ? " (you)" : "") + "</div>" +
      "<div>" + statusPill(p.id) + "</div></div>" +
      (balanceOf(p.id) > 0.004 && p.phone
        ? '<a class="btn nudge sm" href="' + esc(nudgeLink(p)) + '">🔔 Nudge</a>' : "") +
      (me.isAdmin && balanceOf(p.id) > 0.004
        ? ' <button class="linkbtn" data-act="markpaid" data-id="' + p.id + '">mark paid</button>' : "") +
      "</div>";
  }

  function adminToolbarHTML() {
    return '<div class="btnrow" style="margin-top:14px">' +
      '<button class="btn ghost sm" data-act="people">👥 People</button>' +
      '<button class="btn ghost sm" data-act="utils">🧾 Utilities</button>' +
      '<button class="btn ghost sm" data-act="settings">⚙️ Settings</button></div>';
  }

  // ================= MODALS / SHEETS =================
  var modal = $("#modal");
  function openSheet(inner) {
    modal.innerHTML =
      '<div class="scrim" id="scrim"><div class="sheet">' +
      '<button class="linkbtn" style="float:right" data-act="closesheet">Close ✕</button>' +
      inner + "</div></div>";
    $("#scrim").addEventListener("click", function (e) {
      if (e.target.id === "scrim") closeSheet(); // only backdrop taps dismiss
    });
  }
  function closeSheet() { modal.innerHTML = ""; }

  function emojiGridHTML(sel) {
    return '<div class="emojigrid" id="emojiGrid">' + EMOJIS.map(function (e) {
      return '<button type="button" class="emo' + (e === sel ? " sel" : "") + '" data-emo="' + esc(e) + '">' + esc(e) + "</button>";
    }).join("") + "</div>";
  }

  function personFormHTML(p, isBootstrap) {
    p = p || {};
    var rmOptions = roommates().map(function (r) {
      return '<option value="' + r.id + '"' + (p.linkedRoommateId === r.id ? " selected" : "") + ">" + esc(r.name) + "</option>";
    }).join("");
    return '<form id="personForm">' +
      '<div class="field"><label>Name</label><input name="name" value="' + esc(p.name || "") + '" required></div>' +
      '<div class="field"><label>They are a…</label><select name="role">' +
        '<option value="roommate"' + (p.role === "roommate" ? " selected" : "") + ">🐿️ Roommate (in the split)</option>" +
        '<option value="parent"' + (p.role === "parent" ? " selected" : "") + ">Parent (pays, not split)</option>" +
      "</select></div>" +
      '<div class="field" id="linkWrap" style="' + (p.role === "parent" ? "" : "display:none") + '">' +
        '<label>Whose parent? (their daughter)</label><select name="linkedRoommateId"><option value="">—</option>' + rmOptions + "</select></div>" +
      '<div class="field"><label>Venmo username (without @)</label>' +
        '<input name="venmoUsername" value="' + esc(p.venmoUsername || "") + '" placeholder="e.g. ellie-hunter" autocapitalize="none" autocorrect="off" spellcheck="false">' +
        '<a class="verify-venmo" id="verifyVenmo" target="_blank" rel="noopener" style="display:none"></a>' +
        '<div class="tiny" style="margin-top:4px">Tip: open the profile to make sure it\'s the right person before anyone pays.</div></div>' +
      '<div class="field" id="rentWrap" style="' + (p.role === "roommate" || p.role == null ? "" : "display:none") + '">' +
        '<label>Monthly rent for this person ($)</label>' +
        '<input name="rentAmount" type="number" step="0.01" inputmode="decimal" value="' + (Number(p.rentAmount) > 0 ? Number(p.rentAmount) : "") + '" placeholder="e.g. 650">' +
        '<div class="tiny" style="margin-top:4px">Set each roommate\'s own rent (Mia\'s is higher for her private room). Rent auto-appears each month and is paid at the 221 Armstrong portal — leave blank for $0.</div></div>' +
      '<div class="field"><label>Phone (for nudges)</label><input name="phone" type="tel" value="' + esc(p.phone || "") + '" placeholder="+1 334 555 0123"></div>' +
      '<div class="field"><label>Email (for reminders)</label><input name="email" type="email" value="' + esc(p.email || "") + '"></div>' +
      '<div class="field"><label>Pick an avatar</label>' + emojiGridHTML(p.emoji || "🐿️") + '<input type="hidden" name="emoji" value="' + esc(p.emoji || "🐿️") + '"></div>' +
      '<label class="checkrow"><input type="checkbox" name="isAdmin"' + (p.isAdmin ? " checked" : "") + "> Admin (can add bills &amp; people)</label>" +
      '<input type="hidden" name="id" value="' + esc(p.id || "") + '">' +
      '<button class="btn primary" type="submit" style="margin-top:14px">' + (isBootstrap ? "Create house 🌰" : "Save") + "</button>" +
      (p.id && !isBootstrap ? '<button class="btn ghost sm" type="button" data-act="delperson" data-id="' + p.id + '" style="width:100%;margin-top:8px">Delete this person</button>' : "") +
      "</form>";
  }

  function wirePersonForm(isBootstrap) {
    var form = $("#personForm");
    if (!form) return;
    form.addEventListener("click", function (e) {
      var b = e.target.closest("[data-emo]");
      if (b) {
        e.preventDefault();
        Array.prototype.forEach.call(form.querySelectorAll(".emo"), function (x) { x.classList.remove("sel"); });
        b.classList.add("sel");
        form.emoji.value = b.getAttribute("data-emo");
      }
    });
    form.role.addEventListener("change", function () {
      $("#linkWrap").style.display = form.role.value === "parent" ? "" : "none";
      $("#rentWrap").style.display = form.role.value === "roommate" ? "" : "none";
    });
    // live "check this Venmo profile" link that follows what they type
    function updateVenmoVerify() {
      var v = form.venmoUsername.value.trim().replace(/^@/, "");
      var a = $("#verifyVenmo");
      if (v) {
        a.href = venmoProfileLink(v);
        a.textContent = "✓ Open @" + v + "'s Venmo profile ↗";
        a.style.display = "inline-block";
      } else {
        a.style.display = "none";
      }
    }
    form.venmoUsername.addEventListener("input", updateVenmoVerify);
    updateVenmoVerify();
    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      var person = {
        id: form.id.value || uid(),
        name: form.name.value.trim(),
        role: form.role.value,
        linkedRoommateId: form.linkedRoommateId ? form.linkedRoommateId.value : "",
        venmoUsername: form.venmoUsername.value.trim().replace(/^@/, ""),
        phone: form.phone.value.trim(),
        email: form.email.value.trim(),
        emoji: form.emoji.value,
        isAdmin: form.isAdmin.checked,
        rentAmount: (form.role.value === "roommate" ? (parseFloat(form.rentAmount.value) || 0) : 0),
      };
      if (!person.name) return;
      await api("upsertPerson", { person: person });
      if (isBootstrap) localStorage.setItem(K_ME, person.id);
      closeSheet();
      await refresh();
    });
  }

  function openPeopleSheet() {
    var list = STATE.people.map(function (p) {
      return '<div class="person"><div class="avatar mascot">' + esc(p.emoji || "🐿️") + "</div>" +
        '<div class="who"><div class="name">' + esc(p.name) + "</div><div class='sub'>" +
        (p.role === "roommate" ? "🐿️ roommate" : "parent") + (p.isAdmin ? " · admin" : "") +
        (p.venmoUsername ? " · @" + esc(p.venmoUsername) : "") + "</div></div>" +
        '<button class="btn ghost sm" data-act="editperson" data-id="' + p.id + '">Edit</button></div>';
    }).join("");
    openSheet("<h3>People</h3>" + list +
      '<button class="btn primary" data-act="addperson" style="margin-top:14px">➕ Add a person</button>');
  }

  function openPersonEditor(p, isBootstrap) {
    openSheet("<h3>" + (p && p.id ? "Edit " + esc(p.name) : "Add a person") + "</h3>" + personFormHTML(p || {}, false));
    wirePersonForm(isBootstrap);
  }

  function openBillSheet() {
    // Rent is auto-recurring & per-person, so it's not a manually-added split bill
    var utils = STATE.utilities.filter(function (u) { return String(u.id) !== String(STATE.config.rentUtilityId) && u.name !== "Rent"; });
    var utilChips = utils.map(function (u, i) {
      return '<button type="button" class="chip' + (i === 0 ? " sel" : "") + '" data-uid="' + u.id + '">' + esc(u.icon) + " " + esc(u.name) + "</button>";
    }).join("");
    var rmChecks = roommates().map(function (r) {
      return '<label class="checkrow"><input type="checkbox" name="pp" value="' + r.id + '" checked> ' +
        esc(r.emoji || "🐿️") + " " + esc(r.name) + "</label>";
    }).join("");
    openSheet(
      '<h3>Add this month\'s bill</h3>' +
      '<p class="tiny" style="margin:-6px 0 12px">Rent is handled automatically per person — this is for split utilities like power, internet, and water.</p>' +
      '<form id="billForm">' +
      '<div class="field"><label>Which utility?</label><div class="chips" id="utilChips">' + utilChips + "</div>" +
      '<input type="hidden" name="utilityId" value="' + (utils[0] ? utils[0].id : "") + '"></div>' +
      '<div class="field"><label>Total amount ($)</label><input name="amount" type="number" step="0.01" inputmode="decimal" placeholder="115.00" required></div>' +
      '<div class="field"><label>Date</label><input name="date" type="date" value="' + todayISO() + '"></div>' +
      '<div class="field"><label>Note (optional)</label><input name="note" placeholder="March power bill"></div>' +
      '<div class="field"><label>Split between (uncheck to exclude)</label>' + rmChecks + "</div>" +
      '<div class="tiny" id="preview"></div>' +
      '<button class="btn primary" type="submit" style="margin-top:12px">Save & split 🌰</button></form>'
    );
    var form = $("#billForm");
    function updatePreview() {
      var amt = parseFloat(form.amount.value) || 0;
      var n = form.querySelectorAll('input[name="pp"]:checked').length;
      $("#preview").textContent = n && amt ? "= " + money(amt / n) + " each (" + n + " people)" : "";
    }
    $("#utilChips").addEventListener("click", function (e) {
      var c = e.target.closest(".chip"); if (!c) return;
      Array.prototype.forEach.call(form.querySelectorAll(".chip"), function (x) { x.classList.remove("sel"); });
      c.classList.add("sel");
      form.utilityId.value = c.getAttribute("data-uid");
    });
    form.addEventListener("input", updatePreview);
    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      var participantIds = Array.prototype.map.call(form.querySelectorAll('input[name="pp"]:checked'), function (x) { return x.value; });
      if (!participantIds.length) { alert("Pick at least one person to split with."); return; }
      await api("addCharge", {
        charge: {
          utilityId: form.utilityId.value,
          totalAmount: parseFloat(form.amount.value),
          dateAdded: form.date.value || todayISO(),
          note: form.note.value.trim(),
          participantIds: participantIds,
        },
      });
      closeSheet();
      await refresh();
    });
  }

  function openUtilsSheet() {
    var list = STATE.utilities.map(function (u) {
      return '<div class="person"><div class="avatar">' + esc(u.icon) + "</div>" +
        '<div class="who"><div class="name">' + esc(u.name) + "</div></div>" +
        '<button class="linkbtn" data-act="delutil" data-id="' + u.id + '">remove</button></div>';
    }).join("");
    openSheet("<h3>Utilities</h3>" + list +
      '<form id="utilForm"><div class="field"><label>Add a utility</label>' +
      '<input name="name" placeholder="e.g. Trash" required></div>' +
      '<div class="field"><label>Icon (emoji)</label><input name="icon" value="🧾" maxlength="4"></div>' +
      '<button class="btn primary" type="submit">Add</button></form>');
    $("#utilForm").addEventListener("submit", async function (e) {
      e.preventDefault();
      await api("addUtility", { utility: { id: uid(), name: this.name.value.trim(), icon: this.icon.value.trim() || "🧾" } });
      closeSheet(); await refresh();
    });
  }

  function openSettingsSheet() {
    var c = STATE.config;
    openSheet('<h3>Settings ⚙️</h3><form id="cfgForm">' +
      '<div class="field"><label>House name</label><input name="houseName" value="' + esc(c.houseName || "AGD House") + '"></div>' +
      '<div class="field"><label>Email reminder day of month (1–28)</label><input name="reminderDay" type="number" min="1" max="28" value="' + esc(c.reminderDay || 1) + '"></div>' +
      '<div class="tiny" style="margin:-6px 4px 12px">Set this to your real due date so reminders land on time.</div>' +
      '<div class="field"><label>Days until a utility shows "overdue"</label><input name="overdueDays" type="number" min="1" max="90" value="' + esc(c.overdueDays || 10) + '"></div>' +
      '<div class="section-title" style="margin:18px 4px 6px">🏠 Rent</div>' +
      '<div class="field"><label>Rent due day of month (1–28)</label><input name="rentDueDay" type="number" min="1" max="28" value="' + esc(c.rentDueDay || 1) + '"></div>' +
      '<div class="tiny" style="margin:-6px 4px 12px">Rent auto-appears each month; it becomes "overdue" after this day. Set each person\'s rent amount in 👥 People.</div>' +
      '<div class="field"><label>Rent payment portal URL</label><input name="rentPortalUrl" type="url" value="' + esc(c.rentPortalUrl || "") + '"></div>' +
      '<div class="field"><label>How to pay rent (shown in the app)</label><textarea name="rentInstructions" rows="3">' + esc(c.rentInstructions || "") + "</textarea></div>" +
      '<button class="btn primary" type="submit">Save settings</button></form>' +
      '<button class="btn ghost sm" data-act="switch" style="width:100%;margin-top:16px">🔄 Switch to another person</button>' +
      '<button class="btn ghost sm" data-act="logout" style="width:100%;margin-top:8px">Log out of this device</button>');
    $("#cfgForm").addEventListener("submit", async function (e) {
      e.preventDefault();
      await api("updateConfig", { config: {
        houseName: this.houseName.value.trim(),
        reminderDay: parseInt(this.reminderDay.value, 10) || 1,
        overdueDays: parseInt(this.overdueDays.value, 10) || 10,
        rentDueDay: parseInt(this.rentDueDay.value, 10) || 1,
        rentPortalUrl: this.rentPortalUrl.value.trim(),
        rentInstructions: this.rentInstructions.value.trim(),
      }});
      closeSheet(); await refresh();
    });
  }

  // ================= EVENT DELEGATION =================
  document.addEventListener("click", async function (e) {
    var t = e.target.closest("[data-act]");
    if (!t) return;
    var act = t.getAttribute("data-act");
    var id = t.getAttribute("data-id");

    // let real links (venmo/sms) behave natively
    if (t.tagName === "A") return;

    if (act === "closesheet") { closeSheet(); return; }
    if (act === "pickme") { localStorage.setItem(K_ME, id); render(); return; }
    if (act === "switch") { localStorage.removeItem(K_ME); closeSheet(); render(); return; }
    if (act === "logout") { localStorage.removeItem(K_PW); localStorage.removeItem(K_ME); location.reload(); return; }
    if (act === "settings") { openSettingsSheet(); return; }
    if (act === "people") { openPeopleSheet(); return; }
    if (act === "utils") { openUtilsSheet(); return; }
    if (act === "addbill") { openBillSheet(); return; }
    if (act === "addperson") { openPersonEditor({ role: "roommate", emoji: "🐿️" }); return; }
    if (act === "editperson") { openPersonEditor(personById(id)); return; }
    if (act === "editprofile") { openPersonEditor(personById(localStorage.getItem(K_ME))); return; }

    if (act === "ipaid" || act === "paidrent" || act === "markpaid") {
      // ipaid = utilities (Venmo) only, paidrent = rent only, markpaid (admin) = everything
      var scope = act === "ipaid" ? "venmo" : (act === "paidrent" ? "rent" : undefined);
      await api("markPaid", { personId: id, scope: scope });
      celebrate(t);
      await refresh();
      return;
    }
    if (act === "delcharge") {
      if (confirm("Remove this bill and everyone's share of it?")) { await api("deleteCharge", { chargeId: id }); await refresh(); }
      return;
    }
    if (act === "delperson") {
      if (confirm("Delete this person?")) { await api("deletePerson", { id: id }); closeSheet(); await refresh(); }
      return;
    }
    if (act === "delutil") {
      await api("deleteUtility", { id: id }); closeSheet(); await refresh(); openUtilsSheet();
      return;
    }
    if (act === "addphoto") { pickReceipt(id, t); return; }
    if (act === "viewreceipt") { window.open(t.getAttribute("data-url"), "_blank", "noopener"); return; }
    if (act === "delreceipt") {
      if (confirm("Remove this photo?")) { await api("deleteReceipt", { id: id }); await refresh(); }
      return;
    }
  });

  // top bar buttons
  $("#settingsBtn").addEventListener("click", openSettingsSheet);
  $("#switchBtn").addEventListener("click", function () { localStorage.removeItem(K_ME); render(); });

  function celebrate(anchorEl) {
    var r = anchorEl && anchorEl.getBoundingClientRect ? anchorEl.getBoundingClientRect() : null;
    window.squirrelConfetti(r ? { x: r.left + r.width / 2, y: r.top } : {});
    var y = $("#youCard"); if (y) y.classList.add("paidflash");
  }

  // ================= BOOT =================
  async function refresh() {
    STATE = (await api("getState")).state;
    render();
  }

  async function boot() {
    if (DEMO) $("#gateHint").innerHTML = "🧪 <b>Demo mode</b> — password is <b>squirrel</b>";
    if (!PW) return; // show gate
    try {
      await refresh();
      showApp();
    } catch (err) {
      localStorage.removeItem(K_PW); PW = "";
    }
  }

  function showApp() { $("#gate").classList.add("hidden"); $("#app").classList.remove("hidden"); }

  $("#loginForm").addEventListener("submit", async function (e) {
    e.preventDefault();
    var pw = $("#pw").value;
    $("#loginErr").textContent = "";
    try {
      PW = pw;
      await api("login", {});
      localStorage.setItem(K_PW, pw);
      await refresh();
      showApp();
    } catch (err) {
      PW = "";
      $("#loginErr").textContent = "Hmm, that password didn't work 🐿️";
    }
  });

  // ================= DEMO BACKEND =================
  function demoDB() {
    var raw = localStorage.getItem("ss_demo");
    if (raw) return JSON.parse(raw);
    var db = seedDemo();
    localStorage.setItem("ss_demo", JSON.stringify(db));
    return db;
  }
  function saveDemo(db) { localStorage.setItem("ss_demo", JSON.stringify(db)); }

  function seedDemo() {
    var U = function (name, icon) { return { id: uid(), name: name, icon: icon }; };
    var rent = U("Rent", "🏠"), power = U("Power", "⚡"), net = U("Internet", "📶"), water = U("Water/Sewer", "💧");
    var P = function (o) { return Object.assign({ id: uid(), venmoUsername: "", phone: "", email: "", linkedRoommateId: "", isAdmin: false, rentAmount: 0 }, o); };
    // 4 roommates pay the same rent; Mia has a private room so hers is higher
    var mia = P({ name: "Mia", role: "roommate", emoji: "🐿️", venmoUsername: "mia-h", phone: "+13345550101", email: "mia@example.com", rentAmount: 800 });
    var maddie = P({ name: "Maddie", role: "roommate", emoji: "🌹", venmoUsername: "maddie-r", phone: "+13345550102", rentAmount: 650 });
    var ava = P({ name: "Ava", role: "roommate", emoji: "🦋", venmoUsername: "ava-b", phone: "+13345550103", rentAmount: 650 });
    var sofia = P({ name: "Sofia", role: "roommate", emoji: "🌻", venmoUsername: "sofia-g", phone: "+13345550104", rentAmount: 650 });
    var grace = P({ name: "Grace", role: "roommate", emoji: "👑", venmoUsername: "grace-k", phone: "+13345550105", rentAmount: 650 });
    var tim = P({ name: "Dad", role: "parent", emoji: "🦅", isAdmin: true, venmoUsername: "tim-hunter", email: "thunter712@gmail.com", linkedRoommateId: mia.id });
    var mom = P({ name: "Mom", role: "parent", emoji: "🌸", isAdmin: true, venmoUsername: "mom-hunter", linkedRoommateId: mia.id });

    var db = {
      config: {
        password: "squirrel", houseName: "AGD House", reminderDay: 1, overdueDays: 10,
        rentUtilityId: rent.id, rentDueDay: 1,
        rentPortalUrl: "https://two21armstrong.securecafe.com/residentservices/two21-armstrong-apartments-student/userlogin.aspx",
        rentInstructions: "Log in, click Payments at the top of the screen, then select your name. You can also use the \"RentCafe Resident\" app on your phone.",
      },
      utilities: [rent, power, net, water],
      people: [mia, maddie, ava, sofia, grace, tim, mom],
      charges: [],
      shares: [],
      receipts: [],
    };
    var iso = function (d) { var x = new Date(); x.setDate(x.getDate() - d); return x.toISOString().slice(0, 10); };
    demoAddCharge(db, { utilityId: power.id, totalAmount: 115, dateAdded: iso(15), note: "Power", participantIds: [mia, maddie, ava, sofia, grace].map(function (p) { return p.id; }) });
    demoAddCharge(db, { utilityId: net.id, totalAmount: 60, dateAdded: iso(2), note: "Internet", participantIds: [mia, maddie, ava, sofia].map(function (p) { return p.id; }) });
    demoEnsureRent(db); // create this month's per-person rent
    // Mia paid utilities; Maddie paid the power utility only
    db.shares.forEach(function (s) {
      var c = chargeIn(db, s.chargeId);
      if (s.personId === mia.id && c.kind !== "rent") s.status = "paid";
      if (s.personId === maddie.id && c.utilityId === power.id) s.status = "paid";
    });
    return db;
  }
  function chargeIn(db, cid) { return db.charges.find(function (c) { return c.id === cid; }); }
  function demoAddCharge(db, charge) {
    charge.id = uid();
    db.charges.push(charge);
    var amts = splitAmount(charge.totalAmount, charge.participantIds.length);
    charge.participantIds.forEach(function (pid, i) {
      db.shares.push({ id: uid(), chargeId: charge.id, personId: pid, amountOwed: amts[i], status: "unpaid", paidDate: "" });
    });
  }
  // demo mirror of the server's ensureRentForMonth (create/reconcile this month's per-person rent)
  function demoEnsureRent(db) {
    var period = new Date().toISOString().slice(0, 7); // YYYY-MM
    var renters = db.people.filter(function (p) { return p.role === "roommate" && Number(p.rentAmount) > 0; });
    if (!renters.length) return;
    var dueDay = Math.min(Math.max(Number(db.config.rentDueDay) || 1, 1), 28);
    var dueDate = period + "-" + (dueDay < 10 ? "0" : "") + dueDay;
    var rc = db.charges.find(function (c) { return c.kind === "rent" && c.period === period; });
    if (!rc) {
      rc = { id: uid(), utilityId: db.config.rentUtilityId, totalAmount: 0, dateAdded: period + "-01", note: "Rent " + period, participantIds: [], kind: "rent", period: period, dueDate: dueDate };
      db.charges.push(rc);
    } else { rc.dueDate = dueDate; }
    var byPerson = {};
    db.shares.forEach(function (s) { if (s.chargeId === rc.id) byPerson[s.personId] = s; });
    var wantIds = renters.map(function (p) { return p.id; });
    renters.forEach(function (p) {
      var s = byPerson[p.id];
      if (s) { if (s.status === "unpaid") s.amountOwed = Number(p.rentAmount); }
      else db.shares.push({ id: uid(), chargeId: rc.id, personId: p.id, amountOwed: Number(p.rentAmount), status: "unpaid", paidDate: "" });
    });
    db.shares = db.shares.filter(function (s) {
      return s.chargeId !== rc.id || wantIds.indexOf(s.personId) >= 0 || s.status === "paid";
    });
    rc.totalAmount = renters.reduce(function (a, p) { return a + Number(p.rentAmount); }, 0);
    rc.participantIds = wantIds;
  }

  async function demoApi(action, p) {
    await new Promise(function (r) { setTimeout(r, 120); }); // feel like a network
    var db = demoDB();
    if (action === "login") {
      if (PW !== db.config.password) throw new Error("bad password");
      return { ok: true };
    }
    if (PW !== db.config.password) throw new Error("bad password");
    switch (action) {
      case "getState":
        demoEnsureRent(db); saveDemo(db);
        return { ok: true, state: { config: db.config, people: db.people, utilities: db.utilities, charges: db.charges, shares: db.shares, receipts: db.receipts || [] } };
      case "upsertPerson": {
        var i = db.people.findIndex(function (x) { return x.id === p.person.id; });
        if (i >= 0) db.people[i] = p.person; else db.people.push(p.person);
        break;
      }
      case "deletePerson":
        db.people = db.people.filter(function (x) { return x.id !== p.id; });
        break;
      case "addUtility": db.utilities.push(p.utility); break;
      case "deleteUtility": db.utilities = db.utilities.filter(function (x) { return x.id !== p.id; }); break;
      case "addCharge": demoAddCharge(db, p.charge); break;
      case "deleteCharge":
        db.charges = db.charges.filter(function (x) { return x.id !== p.chargeId; });
        db.shares = db.shares.filter(function (x) { return x.chargeId !== p.chargeId; });
        break;
      case "markPaid": {
        var rentIds = db.charges.filter(function (c) { return c.kind === "rent"; }).map(function (c) { return c.id; });
        db.shares.forEach(function (s) {
          if (s.personId !== p.personId || s.status !== "unpaid") return;
          var isRent = rentIds.indexOf(s.chargeId) >= 0;
          if (p.scope === "rent" && !isRent) return;
          if (p.scope === "venmo" && isRent) return;
          s.status = "paid"; s.paidDate = todayISO();
        });
        break;
      }
      case "updateConfig": Object.assign(db.config, p.config); break;
      case "addReceipt":
        db.receipts = db.receipts || [];
        db.receipts.push({ id: uid(), chargeId: String(p.chargeId), fileId: "", viewUrl: p.dataUrl, imgUrl: p.dataUrl, uploadedBy: p.uploadedBy || "", uploadedAt: todayISO(), caption: "" });
        break;
      case "deleteReceipt":
        db.receipts = (db.receipts || []).filter(function (x) { return String(x.id) !== String(p.id); });
        break;
      default: throw new Error("unknown action " + action);
    }
    saveDemo(db);
    return { ok: true };
  }

  boot();
})();
