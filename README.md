# 🐿️ SquirrelSplit

A fun, iPhone-first web app for your Auburn **Alpha Gamma Delta** house to split
monthly utilities (Rent, Power, Internet, Water/Sewer…), see each person's share,
pay by **Venmo** in one tap, and get **email reminders** + one-tap text **nudges**.

- Runs as a **static website on GitHub Pages** (free).
- Shared data lives in a **Google Sheet you own**, via a free **Google Apps Script** backend.
- One shared **house password**. Everyone can see everyone (roommates 🐿️ + parents).
- Fun confetti when someone pays; a gentle "aww, still owed" wobble when a bill is overdue.

---

## 🧪 Try it first (Demo mode)

Out of the box `config.js` is set to `"DEMO"`, so you can open `index.html` and play
with fake data before wiring anything up.

- **Demo password:** `squirrel`
- Nothing is saved to the cloud in demo mode (just your browser).

To run it locally on your Mac:

```bash
cd ApartmentExpenses
python3 -m http.server 8765
# then open http://localhost:8765 in your browser
```

---

## 🚀 Go live in ~20 minutes

### Part A — Create the backend (Google Sheet)

1. Go to **[sheets.new](https://sheets.new)** to make a blank Google Sheet. Name it e.g. "AGD House".
2. In that sheet: **Extensions → Apps Script**. Delete any sample code.
3. Open `apps-script/Code.gs` from this project, copy **all** of it, and paste it in. Click **Save** 💾.
4. Near the top, change this line to your own house password:
   ```js
   var INITIAL_PASSWORD = "auburn-agd-2026"; // <-- change me
   ```
5. In the toolbar function dropdown, pick **`setup`** and click **Run**.
   - Google will ask you to authorize — click through (Advanced → "Go to project (unsafe)" → Allow).
     This is normal for your own script.
   - Your sheet now has tabs: Config, People, Utilities (pre-filled with Rent/Power/Internet/Water), Charges, Shares.
6. Pick **`createDailyReminderTrigger`** in the dropdown and click **Run** once. This turns on
   the monthly reminder emails (it checks daily and emails on your chosen day).

### Part B — Deploy it as a web app

7. Click **Deploy → New deployment**. Click the gear ⚙️ → **Web app**.
   - **Description:** SquirrelSplit
   - **Execute as:** Me
   - **Who has access:** **Anyone**
   - Click **Deploy**, authorize if asked, then **copy the Web app URL** (ends in `/exec`).

### Part C — Publish the website on GitHub Pages

8. Open `config.js` and paste your URL:
   ```js
   window.SQUIRREL_CONFIG = { apiUrl: "https://script.google.com/macros/s/AKfy..../exec" };
   ```
9. Create a **public** GitHub repo and upload all these files (or push this folder).
10. In the repo: **Settings → Pages → Build and deployment → Source: Deploy from a branch →
    Branch: `main` / root → Save.** After a minute GitHub gives you a link like
    `https://yourname.github.io/apartmentexpenses/`.
11. Open that link on your iPhone → Share button → **Add to Home Screen**. 🎉

### Part D — Fill it in (first launch)

12. Enter your house password. The first time (empty sheet) it asks you to **create the admin**
    — that's you (a parent, admin). Then use **👥 People** to add the 5 roommates and the other
    parents, and **🧾 Utilities** if you want more than the four defaults.
    - Each person gets: name, role (🐿️ roommate = in the split, or parent = pays), Venmo username,
      phone (for nudges), email (for reminders), and their own **avatar emoji**.
    - Roommates & parents can change **their own avatar** anytime with the ✏️ button.

---

## 🗓️ How you use it each month

- Tap **➕ Add a bill** → pick the utility → type the amount → (optionally uncheck anyone who
  isn't on that bill) → **Save**. It splits evenly and gives everyone their share.
- Roommates open the app, tap **Pay @you** (opens Venmo pre-filled), then **"I paid it"** 🎉.
- Overdue after **10 days** (change in ⚙️ Settings). Reminder email goes out on the **1st**
  (change the day in ⚙️ Settings — set it to your real due date).

---

## 🏠 Rent (special — not Venmo, not split evenly)

Rent works differently from utilities:

- **Per-person amounts:** set each roommate's own rent in **👥 People → Edit** (e.g. Mia's is higher
  for her private room). Not divided by 5.
- **Auto-recurring:** rent appears automatically each month — you never hit "Add a bill" for it.
  Set the **rent due day** in ⚙️ Settings; a person's rent shows "overdue" after that day.
- **Paid at the 221 Armstrong portal**, not Venmo. The app shows a **Pay rent at 221 Armstrong**
  button (opens the RentCafe SecureCafe portal) plus the steps: *Log in → Payments → select your name*
  (or the **RentCafe Resident** app). Portal URL + steps are editable in ⚙️ Settings.
- Everyone marks their own rent paid with **"I paid rent"** (separate from utilities).

## ⬆️ Updating an existing deployment (run this after a code update)

When the backend code changes (like the rent feature), after pasting the new `Code.gs`:

1. Run **`migrate()`** once (function dropdown → Run). It adds the new columns/settings to your
   Sheet **without deleting your data**.
2. **Redeploy:** Deploy → Manage deployments → edit ✏️ → Version: **New version** → Deploy.
   (The `/exec` URL stays the same — no need to touch `config.js`.)

---

## 🔧 Notes & FAQ

- **Change the password anytime:** edit the value next to `password` on the **Config** tab of your Sheet.
- **Fix data directly:** it's your Google Sheet — you can edit any cell (e.g. correct an amount).
- **Redeploy after editing Code.gs:** Deploy → Manage deployments → edit ✏️ → Version: New version → Deploy.
- **Venmo:** Venmo has no official payment API, so "paid" is trust-based self-marking, and the
  Pay button opens Venmo pre-filled (amount + note) for a quick manual send. As admin you can also
  tap **"mark paid"** on anyone.
- **Automated texts:** not included (they require a paid service like Twilio). The one-tap 🔔 Nudge
  opens your Messages app pre-written instead — free and instant.
- **Security:** a single shared password over a public endpoint keeps strangers out; it is not
  bank-grade. Don't store anything more sensitive than what's here.

Made for the AGD house at Auburn. War Eagle 🦅 · 🐿️
