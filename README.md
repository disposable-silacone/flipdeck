# FlipDeck – CSV Flashcards

FlipDeck is a **static flashcard web app** that runs entirely in the browser. It loads flashcards from a **published Google Sheets CSV link**, lets you study them, and saves your progress locally using **IndexedDB**.

There is **no backend and no build step** – it works directly on GitHub Pages.

---

## Features

- **Google Sheets CSV as source of truth**
  - 3 columns: `Topic`, `Term`, `Definition` (order can vary, header names are matched case-insensitively)
  - Ignores blank rows
  - Blank `Topic` → treated as `Uncategorized`
- **Study experience**
  - One card at a time
  - Front: **Term**, Back: **Definition**
  - Flip by clicking the card, `Space`, or `Enter`
  - Previous / Next navigation with buttons or ← / → arrow keys
  - Shuffle toggle
  - Topic filter dropdown
  - Known / Unknown buttons
  - Toggle: **Study Unknown Only**
- **Persistence (IndexedDB)**
  - Deck list (name + CSV URL)
  - Known / Unknown state per card
  - Last selected deck
  - Shuffle state
  - Unknown-only toggle
  - Selected topic

---

## Files

- `index.html` – main page and layout
- `styles.css` – layout and visual styling
- `app.js` – application logic, CSV parsing, and persistence
- `SPEC.txt` – original spec (not required for runtime)

All assets are plain HTML/CSS/JS and can be hosted directly on GitHub Pages.

---

## How to Use the App

### 1. Open the app

If you are running it locally:

1. Open `index.html` in a modern browser (Chrome, Edge, Firefox, Safari).

If you deployed to GitHub Pages:

1. Go to your repository’s Pages URL (e.g. `https://YOURUSERNAME.github.io/flashcards`).

---

### 2. Create a Google Sheet for your deck

1. Go to Google Sheets and create a new spreadsheet.
2. Add a header row with **at least** these columns:
   - `Topic`
   - `Term`
   - `Definition`
3. Add one card per row:
   - `Topic`: Group or category (can be blank → becomes `Uncategorized`).
   - `Term`: The front of the card.
   - `Definition`: The back of the card.
4. You can include commas, quotes, and special characters; they are handled by the CSV parser.

> Only rows with both **Term** and **Definition** are counted as cards.

---

### 3. Publish the sheet as CSV (Google Sheets “Publish to web”)

To get the CSV URL that FlipDeck uses:

1. In your Google Sheet, go to **File → Share → Publish to web…**.
2. In the dialog:
   - Under **Link**, choose the specific sheet/tab that contains your flashcards.
   - For **format**, choose **CSV**.
3. Click **Publish** (confirm if prompted).
4. Copy the generated **link** – this is your **CSV URL**.

You can later stop publishing via **File → Share → Publish to web… → Stop publishing** if needed.

---

### 4. Add the deck in FlipDeck

In the **Deck Manager** panel (right side):

1. In **Deck name**, enter something like `Biology – Cells`.
2. In **Google Sheets CSV URL**, paste the CSV link you copied from Google Sheets.
3. Click **Save deck**.

The deck will now appear in the **Deck** dropdown at the top bar. Deck metadata is stored locally in IndexedDB, so it will still be there after refresh.

---

### 5. Load and study a deck

1. In the **Deck** dropdown (top bar), choose your deck.
2. Click **Load**.
3. The app will:
   - Fetch the CSV from Google Sheets.
   - Parse it using **PapaParse** (via CDN).
   - Build cards based on `Topic`, `Term`, and `Definition`.
   - Restore any previously saved Known/Unknown state for that deck.

You’ll then see the first card:

- Click the card, press `Space`, or press `Enter` to flip between term and definition.
- Use **Previous** / **Next** buttons or your keyboard arrows (← / →) to move between cards.

---

### 6. Mark Known / Unknown and use filters

- **Known / Unknown buttons**
  - Click **Mark Known** when you know a card.
  - Click **Mark Unknown** when you don’t.
  - This state is saved in IndexedDB per card and deck.
- **Shuffle toggle**
  - Turn on to view cards in random order.
  - State is remembered across sessions.
- **Topic dropdown**
  - Choose a specific topic to study only that group.
  - Choose **All topics** to see everything.
- **Unknown only toggle**
  - When enabled, only cards marked as **Unknown** are shown.
  - This is persistent across sessions.

If your filters result in **no cards**, the app will show a message in the card area.

---

### 7. Delete a deck

1. Select the deck you want to remove in the **Deck** dropdown.
2. Click **Delete deck** in the Deck Manager.
3. Confirm the deletion.

This removes:

- The deck metadata (name + CSV URL).
- All stored progress (Known/Unknown) for that deck.

---

## How it Works (Technical Overview)

- **CSV parsing**
  - The app loads PapaParse from a CDN in `index.html`.
  - It fetches the CSV URL with `fetch`, then calls `Papa.parse(csvText, { header: true, skipEmptyLines: 'greedy' })`.
  - Headers are normalized to lowercase, so any casing of `Topic`, `Term`, `Definition` is accepted.
- **Data model**
  - **Deck**
    - `id`
    - `name`
    - `csvUrl`
    - `createdAt`
    - `updatedAt`
  - **Card (in-memory)**
    - `id` (hash of `term + definition`)
    - `topic`
    - `term`
    - `definition`
    - `known` (boolean, from stored progress or default `false`)
  - **Settings**
    - `lastDeckId`
    - `shuffleEnabled`
    - `filterUnknownOnly`
    - `selectedTopic`
- **IndexedDB**
  - Database name: `flashcards_db`
  - Object stores:
    - `decks` – metadata for each deck.
    - `card_progress` – known state per card per deck.
    - `settings` – global UI state.

All data stays in the browser; nothing is uploaded to a server.

---

## Deploying on GitHub Pages (no build step)

1. **Create a GitHub repository**
   - Go to GitHub and create a new public repository.
   - Name it something like `flashcards` or `flipdeck`.
2. **Add the files**
   - Add `index.html`, `styles.css`, `app.js`, and (optionally) `README.md` and `SPEC.txt` to the root of the repo.
   - Commit and push to the `main` branch.
3. **Enable GitHub Pages**
   - In your repo, go to **Settings → Pages**.
   - Under **Source**, choose:
     - **Branch**: `main`
     - **Folder**: `/ (root)`
   - Click **Save**.
4. Wait a minute for GitHub Pages to build. Your app will be live at:
   - `https://YOURUSERNAME.github.io/flashcards`
   - (Replace `YOURUSERNAME` and repo name as appropriate.)

Because the app uses only static assets and CDN resources, **no additional configuration or build step is needed**.

---

## Troubleshooting

- **No cards appear after loading**
  - Check that your sheet has the headers `Topic`, `Term`, and `Definition` (any casing).
  - Make sure each row has both a Term and a Definition.
  - Confirm that you published the correct sheet/tab as CSV.
- **Known/Unknown progress not saving**
  - Ensure you’re using the same browser and device; IndexedDB is local per browser.
  - Check that your browser allows local storage/IndexedDB (not in an overly restrictive private mode).
- **GitHub Pages shows a 404**
  - Confirm that:
    - Pages is enabled for the `main` branch and root folder.
    - `index.html` exists at the root of the repository.

If you run into issues, you can inspect the browser **Developer Tools → Console** for errors. The app logs CSV parsing and storage issues there.

# flipdeck