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

## Stage 3: Put the app online (GitHub Pages) and try the Library

Do Stage 2 first. You need the backend's `/exec` address and your passcode.

### 3a. Turn on GitHub Pages
1. On GitHub, open the repository → **Settings → Pages** (left sidebar).
2. Under **Build and deployment → Source**, choose **Deploy from a branch**.
3. Branch: **`claude/reading-library-pwa-di19cb`**, folder **`/ (root)`** → **Save**.
4. Wait a minute or two and refresh. The page shows **"Your site is live at https://nsarks.github.io/bookrecommendations/"**.

(Later, once we merge into `main`, we'll switch this to `main`.)

### 3b. Try it on your phone
1. Open **https://nsarks.github.io/bookrecommendations/** in Chrome.
2. **Backend address:** paste the Web app URL from Stage 2 (ends in `/exec`). **Passcode:** yours. Tap **Connect**.
3. Choose **Sophie** or **Nick**. You should see the shelf, with search and the Read / TBR / Stopped Reading chips. Tap a book to see its details. A ⚑ marks books that need attention, such as a missing rating.

The phone remembers the address, passcode and chosen person. Use **switch user** to change person, and ⚙︎ to change the connection.

### Trying it locally (optional, for developing)
`node tests/mock-server.js`, then open http://localhost:8080 and use backend address `http://localhost:8080/exec` with passcode `test`. This uses made-up sample books, not your Sheet.

## Stage 4–5: Adding, updating and managing books

Nothing to set up for the app itself: GitHub Pages updates on its own a minute or two after each push. If your phone shows an old version, pull down to refresh.

**Backend update (Author is now optional):** paste the latest [`apps-script/Api.gs`](../apps-script/Api.gs) over your `Api` file, save, then **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy**. The `/exec` address stays the same.

## Stage 6: The librarian (Recommend tab)

You should already have `GEMINI_API_KEY` in Script Properties (free tier, no billing).

### 6a. Update the backend code
1. In Apps Script, paste the latest [`apps-script/Api.gs`](../apps-script/Api.gs) over your `Api` file.
2. **+ → Script**, name it `Librarian`, paste in [`apps-script/Librarian.gs`](../apps-script/Librarian.gs). Save.
   You should now have four files: `Cleaning`, `Setup`, `Api`, `Librarian`.

### 6b. Check the key and pick a model
1. Open `Librarian`, choose **testGemini** in the function dropdown, **Run**. Approve the new permission ("connect to an external service": that's the call to Gemini).
2. The **Execution log** shows the Flash models your key can use, the order the librarian will try them in, and a one-line test reply saying which model answered.
3. To prefer a particular model, add a Script Property `GEMINI_MODEL` with its exact name from that list (e.g. `gemini-3.8-flash`). If it's busy or unavailable, the librarian tries `gemini-3.7-flash`, then `gemini-3.5-flash` (at most 3 requests per tap). After free-limit errors it pauses for a minute. Not sure which model to use? Run **diagnoseGemini** in the `Librarian` file: it tests each model and suggests one.

### 6c. Redeploy
**Deploy → Manage deployments → ✏️ → Version: New version → Deploy.** Same address as before.

### 6d. Try it
On your phone, pull down to refresh, open **Recommend**, optionally type a steer, and tap **Recommend**. It usually takes 5–20 seconds.
- Each recommended book has **Add to TBR**.
- The last answer is remembered on the phone until you ask again.
- After each chat the librarian remembers the time, so next time it can comment on books added since.
- If any of your books have no author, the librarian fills it in and marks the row "Author filled in by the librarian, please check".

**Free-tier limits:** if you see "The librarian is a little busy", you've hit the free per-minute or daily limit. Wait a minute (or until tomorrow) and try again. Nothing is ever charged.

**Optional:** `testRecommend` in the `Librarian` file runs a full recommendation for Sophie and logs it. Note that it counts as a chat (it updates the last-chat time).

### 6e. OpenRouter as the main librarian (free models, no card)
Gemini's free Flash models were overloaded, Mistral's API now needs a paid plan, and Groq refused access ("Access denied. Please check your network settings."). So the librarian asks **OpenRouter's free models** first (a free Mistral model, then a free Llama 70B) and uses Gemini as the backup.
1. Go to **openrouter.ai** and sign in (e.g. with Google). Don't add credits or a card.
2. Optional but recommended: **Settings → Privacy**. Free models may only be available if you allow providers that can log or train on prompts; leave the defaults unless testOpenRouter says no free models are allowed.
3. **Keys → Create Key**, name it `reading-library`, leave the credit limit empty, copy the key (shown once).
4. Apps Script → ⚙️ **Project Settings → Script Properties**: add `OPENROUTER_API_KEY` = your key. Save.
5. Paste the latest [`apps-script/Librarian.gs`](../apps-script/Librarian.gs) over your `Librarian` file and save.
6. Run **testOpenRouter**. The log lists the free models, the order they'll be tried, and a test hello.
7. Redeploy: **Deploy → Manage deployments → select it → ✏️ → New version → Deploy.**

Optional settings (Script Properties):
- `OPENROUTER_MODEL`: a free model from the testOpenRouter list (ends in `:free`) to try first.
- `LLM_ORDER`: default `mistral,openrouter,groq,gemini`; services without a key are skipped.
- `MISTRAL_API_KEY` / `GROQ_API_KEY` still work if you ever get them.

Free OpenRouter models have a small daily allowance (plenty for two people) and the list of free models changes from time to time. If the preferred ones disappear, run testOpenRouter and set `OPENROUTER_MODEL` to one from the list.
