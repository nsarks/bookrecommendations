# Setup guide

Each stage adds a section here. Do them in order.

## Stage 1: Tidy the Sheet and add Nick's tab

What this does: renames your existing tab to **Sophie (original backup)** and leaves it untouched, builds a new tidied **Sophie** tab from it, adds an empty **Nick** tab, a hidden **Meta** tab (remembers when each of you last chatted with the librarian), and a **Setup report** tab listing every change.

New columns are added on the right: **Added**, **Updated** (so the librarian can spot books added since your last chat) and **Needs attention** (e.g. "Missing rating").

1. Open the Google Sheet **My Reading Library** on a computer.
2. Menu: **Extensions → Apps Script**. A new tab opens with a file called `Code.gs`.
3. Rename `Code.gs` to `Cleaning` (click the three dots next to it → Rename) and replace its contents with everything in [`apps-script/Cleaning.gs`](../apps-script/Cleaning.gs).
4. Click **+** next to *Files* → **Script**, name it `Setup`, and paste in [`apps-script/Setup.gs`](../apps-script/Setup.gs).
5. Click the 💾 save icon.
6. In the toolbar's function dropdown choose **setupLibrary**, then click **Run**.
7. Google will ask for permission the first time:
   **Review permissions → choose your account → Advanced → Go to (project name) (unsafe) → Allow.**
   "Unsafe" only means Google hasn't reviewed a script you wrote yourself. It only gets access to this one spreadsheet.
8. Go back to the Sheet. You should see a toast saying *Setup complete*, and tabs **Sophie**, **Nick**, **Sophie (original backup)** and **Setup report**.
9. Open **Setup report** and look at the *Needs attention* list at the bottom. Fill in any missing ratings directly in the **Sophie** tab, then clear that row's *Needs attention* cell.

If setup stops partway with an error, just run it again: it carries on from the untouched backup. Any half-built Sophie tab from a failed run is renamed "...(failed setup, safe to delete)" rather than deleted.

Once you're happy you can delete **Setup report** (and later, the backup).

**To fix a misspelt title the script doesn't know about**, just edit it in the Sheet. The list of known fixes is at the top of `Cleaning.gs` (`TITLE_FIXES`, `AUTHOR_FIXES`).

## Stage 2: The backend (Apps Script web app)

The backend is the only thing allowed to touch your Sheet. The app talks to it over the internet, and every request must carry your passcode.

### 2a. Add the code
1. In the Sheet: **Extensions → Apps Script**.
2. Click **+** next to *Files* → **Script**, name it `Api`, and paste in [`apps-script/Api.gs`](../apps-script/Api.gs). Save.
   (You should now have three files: `Cleaning`, `Setup`, `Api`.)

### 2b. Store the passcode (never in the code)
1. Left sidebar: ⚙️ **Project Settings**.
2. Scroll to **Script Properties → Add script property**.
3. Property: `PASSCODE` · Value: your passcode. **Save script properties.**
   Tip: a short phrase is better than a 4-digit PIN, e.g. `ginger-bookshelf-42`.

### 2c. Check it works (before going online)
1. Back in the editor (`< >` icon), open `Api`, choose **testBackend** in the function dropdown, click **Run**.
2. Open **Execution log** at the bottom. You should see:
   - *Wrong passcode (should fail)* → `"ok":false`
   - *Sophie list* → a count of about 127
   - *Add test book* → `"created":true`
   - *Same title, different spacing* → `"created":false` (proves duplicates are caught)
   - *Delete test book* → `"deleted":true`
   
   Your Nick tab is left empty afterwards.

### 2d. Put it online
1. Top right: **Deploy → New deployment**.
2. Click the ⚙️ next to *Select type* → **Web app**.
3. Description: `v1` · **Execute as: Me** · **Who has access: Anyone**.
   ("Anyone" is needed so the phones can reach it without signing in to Google. The passcode is what keeps strangers out, and the script runs as you so the Sheet itself stays private.)
4. **Deploy**, approve permissions if asked, then **copy the Web app URL** (ends in `/exec`).
5. Paste that URL into a browser tab. You should see `{"ok":true,"app":"Our Reading Library","message":"Backend is running."}`.

Keep the URL somewhere handy (e.g. a note on your phone). It isn't secret like the passcode, but don't post it publicly.

**Whenever the backend code changes later:** **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy.** This keeps the same URL.

### 2e. Make the repository public (for GitHub Pages)
On GitHub: the repo → **Settings → General →** scroll to **Danger Zone → Change visibility → Make public.** Nothing personal is stored in the repo: your books live in the Sheet and the passcode lives in Script Properties.
