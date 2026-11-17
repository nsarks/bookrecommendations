# Setup guide

Each stage adds a section here. Do them in order.

## Stage 1: Tidy the Sheet and add Nick's tab

What this does: renames your existing tab to **Sophie**, tidies every row, keeps an untouched backup, adds an empty **Nick** tab, a hidden **Meta** tab (remembers when each of you last chatted with the librarian), and a **Setup report** tab listing every change.

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

If something looks wrong you can delete the Sophie, Nick, Meta and Setup report tabs, rename the backup to `Sheet1` and run it again.

Once you're happy you can delete **Setup report** (and later, the backup).

**To fix a misspelt title the script doesn't know about**, just edit it in the Sheet. The list of known fixes is at the top of `Cleaning.gs` (`TITLE_FIXES`, `AUTHOR_FIXES`).
