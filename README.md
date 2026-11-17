# Our Reading Library

A small installable web app for Nick and Sophie to log the books they read and ask a friendly "librarian" for recommendations. Data lives in a private Google Sheet; a Google Apps Script web app is the backend.

- `apps-script/` – code you paste into the Sheet's Apps Script editor
- `docs/SETUP.md` – step-by-step setup instructions
- `index.html`, `app.js`, `app.css` – the app (served by GitHub Pages)
- `tests/` – run `node tests/cleaning.test.js`, `node tests/api.test.js` and `node tests/librarian.test.js`; `node tests/mock-server.js` runs the app locally with sample data

No secrets or reading data are stored in this repository.
