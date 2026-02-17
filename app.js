(() => {
  'use strict';

  // IndexedDB configuration
  const DB_NAME = 'flashcards_db';
  const DB_VERSION = 1;
  const DECKS_STORE = 'decks';
  const PROGRESS_STORE = 'card_progress';
  const SETTINGS_STORE = 'settings';

  /**
   * Global in-memory state
   */
  const state = {
    db: null,
    decks: [],
    currentDeck: null,
    cards: [], // all cards for current deck
    filteredCards: [], // cards after topic/unknown filters
    currentIndex: 0,
    isFlipped: false,
    shuffleEnabled: false,
    unknownOnly: false,
    selectedTopic: 'ALL',
    cardProgressMap: new Map(), // key: cardId, value: { known: boolean }
  };

  /**
   * DOM references
   */
  const els = {};

  document.addEventListener('DOMContentLoaded', init);

  /**
   * Initialize application
   */
  function init() {
    cacheDom();
    attachEventListeners();
    openDatabase()
      .then(() => Promise.all([loadDecksFromDb(), loadSettingsFromDb()]))
      .then(([decks, settings]) => {
        state.decks = decks;
        applySettings(settings);
        populateDeckDropdown();

        if (settings && settings.lastDeckId) {
          const deck = decks.find((d) => d.id === settings.lastDeckId);
          if (deck) {
            els.deckSelect.value = deck.id;
            loadDeck(deck.id);
          }
        }
      })
      .catch((err) => {
        console.error('Initialization error', err);
        showToast('Failed to initialize app. Check console for details.');
      });
  }

  function cacheDom() {
    els.deckSelect = document.getElementById('deckSelect');
    els.loadDeckBtn = document.getElementById('loadDeckBtn');
    els.shuffleToggle = document.getElementById('shuffleToggle');
    els.topicFilter = document.getElementById('topicFilter');
    els.unknownOnlyToggle = document.getElementById('unknownOnlyToggle');

    els.card = document.getElementById('card');
    els.cardFrontText = document.getElementById('cardFrontText');
    els.cardBackText = document.getElementById('cardBackText');
    els.topicLabel = document.getElementById('topicLabel');
    els.counter = document.getElementById('counter');

    els.prevBtn = document.getElementById('prevBtn');
    els.flipBtn = document.getElementById('flipBtn');
    els.nextBtn = document.getElementById('nextBtn');
    els.knownBtn = document.getElementById('knownBtn');
    els.unknownBtn = document.getElementById('unknownBtn');

    els.deckNameInput = document.getElementById('deckNameInput');
    els.csvUrlInput = document.getElementById('csvUrlInput');
    els.saveDeckBtn = document.getElementById('saveDeckBtn');
    els.deleteDeckBtn = document.getElementById('deleteDeckBtn');

    els.toast = document.getElementById('toast');
  }

  function attachEventListeners() {
    if (!els.card) return;

    els.loadDeckBtn.addEventListener('click', () => {
      const deckId = els.deckSelect.value;
      if (!deckId) {
        showToast('Select a deck first.');
        return;
      }
      loadDeck(deckId);
    });

    els.shuffleToggle.addEventListener('change', () => {
      state.shuffleEnabled = !!els.shuffleToggle.checked;
      saveSettingsToDb();
      rebuildWorkingSet();
      applyFilters();
    });

    els.topicFilter.addEventListener('change', () => {
      const value = els.topicFilter.value;
      state.selectedTopic = value || 'ALL';
      saveSettingsToDb();
      applyFilters();
    });

    els.unknownOnlyToggle.addEventListener('change', () => {
      state.unknownOnly = !!els.unknownOnlyToggle.checked;
      saveSettingsToDb();
      applyFilters();
    });

    els.card.addEventListener('click', () => {
      flipCard();
    });

    els.card.addEventListener('keydown', (e) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        flipCard();
      }
      if (e.key === 'ArrowRight') {
        nextCard();
      }
      if (e.key === 'ArrowLeft') {
        prevCard();
      }
    });

    els.flipBtn.addEventListener('click', () => flipCard());
    els.nextBtn.addEventListener('click', () => nextCard());
    els.prevBtn.addEventListener('click', () => prevCard());

    els.knownBtn.addEventListener('click', () => setKnownState(true));
    els.unknownBtn.addEventListener('click', () => setKnownState(false));

    els.saveDeckBtn.addEventListener('click', () => addDeck());
    els.deleteDeckBtn.addEventListener('click', () => deleteDeck());
  }

  // ---------------------------------------------------------------------------
  // IndexedDB helpers
  // ---------------------------------------------------------------------------

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        if (!db.objectStoreNames.contains(DECKS_STORE)) {
          db.createObjectStore(DECKS_STORE, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(PROGRESS_STORE)) {
          const store = db.createObjectStore(PROGRESS_STORE, { keyPath: 'id' });
          store.createIndex('by_deck', 'deckId', { unique: false });
        }
        if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
          db.createObjectStore(SETTINGS_STORE, { keyPath: 'id' });
        }
      };

      request.onsuccess = () => {
        state.db = request.result;
        resolve(state.db);
      };
    });
  }

  function withStore(storeName, mode, fn) {
    return new Promise((resolve, reject) => {
      const tx = state.db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      const request = fn(store);
      tx.oncomplete = () => resolve(request && request.result);
      tx.onerror = () => reject(tx.error || (request && request.error));
    });
  }

  function loadDecksFromDb() {
    return withStore(DECKS_STORE, 'readonly', (store) => store.getAll()).then(
      (result) => result || []
    );
  }

  function saveDeckToDb(deck) {
    return withStore(DECKS_STORE, 'readwrite', (store) => store.put(deck));
  }

  function deleteDeckFromDb(deckId) {
    return withStore(DECKS_STORE, 'readwrite', (store) => store.delete(deckId));
  }

  function deleteProgressForDeckFromDb(deckId) {
    return new Promise((resolve, reject) => {
      const tx = state.db.transaction(PROGRESS_STORE, 'readwrite');
      const store = tx.objectStore(PROGRESS_STORE);
      const index = store.index('by_deck');
      const range = IDBKeyRange.only(deckId);
      const request = index.openCursor(range);

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  function saveSettingsToDb() {
    const payload = {
      id: 'global',
      lastDeckId: state.currentDeck ? state.currentDeck.id : null,
      shuffleEnabled: state.shuffleEnabled,
      filterUnknownOnly: state.unknownOnly,
      selectedTopic: state.selectedTopic,
    };
    return withStore(SETTINGS_STORE, 'readwrite', (store) => store.put(payload));
  }

  function loadSettingsFromDb() {
    return withStore(SETTINGS_STORE, 'readonly', (store) =>
      store.get('global')
    ).then((result) => result || null);
  }

  function saveCardProgressForCurrentDeck() {
    if (!state.currentDeck) return Promise.resolve();
    const deckId = state.currentDeck.id;

    return new Promise((resolve, reject) => {
      const tx = state.db.transaction(PROGRESS_STORE, 'readwrite');
      const store = tx.objectStore(PROGRESS_STORE);

      // Save each card's known state
      state.cards.forEach((card) => {
        const key = `${deckId}::${card.id}`;
        const known = !!card.known;
        store.put({
          id: key,
          deckId,
          cardId: card.id,
          known,
        });
      });

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  function loadCardProgressForDeck(deckId) {
    return new Promise((resolve, reject) => {
      const tx = state.db.transaction(PROGRESS_STORE, 'readonly');
      const store = tx.objectStore(PROGRESS_STORE);
      const index = store.index('by_deck');
      const range = IDBKeyRange.only(deckId);
      const request = index.getAll(range);

      request.onsuccess = () => {
        const results = request.result || [];
        const map = new Map();
        results.forEach((row) => {
          map.set(row.cardId, { known: !!row.known });
        });
        resolve(map);
      };
      request.onerror = () => reject(request.error);
    });
  }

  // ---------------------------------------------------------------------------
  // Deck management
  // ---------------------------------------------------------------------------

  function populateDeckDropdown() {
    els.deckSelect.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Select a deck…';
    els.deckSelect.appendChild(placeholder);

    state.decks
      .slice()
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
      .forEach((deck) => {
        const opt = document.createElement('option');
        opt.value = deck.id;
        opt.textContent = deck.name;
        els.deckSelect.appendChild(opt);
      });
  }

  function addDeck() {
    const name = (els.deckNameInput.value || '').trim();
    const csvUrl = (els.csvUrlInput.value || '').trim();

    if (!name || !csvUrl) {
      showToast('Deck name and CSV URL are required.');
      return;
    }

    const now = Date.now();
    const id = `deck_${now}_${Math.random().toString(36).slice(2, 8)}`;
    const deck = {
      id,
      name,
      csvUrl,
      createdAt: now,
      updatedAt: now,
    };

    saveDeckToDb(deck)
      .then(() => {
        state.decks.push(deck);
        populateDeckDropdown();
        els.deckSelect.value = deck.id;
        showToast('Deck saved.');
      })
      .catch((err) => {
        console.error('Failed to save deck', err);
        showToast('Failed to save deck.');
      });
  }

  function deleteDeck() {
    const deckId = els.deckSelect.value;
    if (!deckId) {
      showToast('Select a deck to delete.');
      return;
    }

    const deck = state.decks.find((d) => d.id === deckId);
    const confirmed = window.confirm(
      `Delete deck "${deck ? deck.name : 'this deck'}" and its progress?`
    );
    if (!confirmed) return;

    Promise.all([
      deleteDeckFromDb(deckId),
      deleteProgressForDeckFromDb(deckId),
    ])
      .then(() => {
        state.decks = state.decks.filter((d) => d.id !== deckId);
        if (state.currentDeck && state.currentDeck.id === deckId) {
          clearCurrentDeckState();
        }
        populateDeckDropdown();
        showToast('Deck deleted.');
        saveSettingsToDb();
      })
      .catch((err) => {
        console.error('Failed to delete deck', err);
        showToast('Failed to delete deck.');
      });
  }

  function clearCurrentDeckState() {
    state.currentDeck = null;
    state.cards = [];
    state.filteredCards = [];
    state.cardProgressMap.clear();
    state.currentIndex = 0;
    state.isFlipped = false;
    renderCard();
  }

  // ---------------------------------------------------------------------------
  // Deck loading, CSV fetch & parse
  // ---------------------------------------------------------------------------

  function loadDeck(deckId) {
    const deck = state.decks.find((d) => d.id === deckId);
    if (!deck) {
      showToast('Deck not found.');
      return;
    }

    state.currentDeck = deck;
    showToast('Loading deck…');

    Promise.all([
      fetchCsv(deck.csvUrl),
      loadCardProgressForDeck(deck.id),
    ])
      .then(([csvText, progressMap]) => {
        state.cardProgressMap = progressMap;
        const cards = parseCsv(csvText, progressMap);
        state.cards = cards;
        state.currentIndex = 0;
        state.isFlipped = false;

        // Refresh settings-linked controls
        applySettingsToControls();

        rebuildWorkingSet();
        buildTopicFilterOptions();
        applyFilters();

        // Update updatedAt and persist
        deck.updatedAt = Date.now();
        return Promise.all([
          saveDeckToDb(deck),
          saveSettingsToDb(),
          saveCardProgressForCurrentDeck(),
        ]);
      })
      .then(() => {
        showToast('Deck loaded.');
      })
      .catch((err) => {
        console.error('Failed to load deck', err);
        showToast('Failed to load deck. Check URL or console.');
      });
  }

  function fetchCsv(url) {
    return fetch(url, { cache: 'no-store' }).then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response.text();
    });
  }

  function parseCsv(csvText, progressMap) {
    const result = Papa.parse(csvText, {
      header: true,
      skipEmptyLines: 'greedy',
    });

    if (result.errors && result.errors.length) {
      console.warn('PapaParse errors', result.errors);
    }

    const rows = result.data || [];
    const cards = [];

    for (const row of rows) {
      if (!row) continue;
      const normalized = {};
      Object.keys(row).forEach((key) => {
        if (!key) return;
        const normalizedKey = key.trim().toLowerCase();
        normalized[normalizedKey] = row[key];
      });

      let topic = (normalized['topic'] || '').trim();
      const term = (normalized['term'] || '').trim();
      const definition = (normalized['definition'] || '').trim();

      if (!term || !definition) continue;
      if (!topic) topic = 'Uncategorized';

      const id = hashString(`${term.toLowerCase()}||${definition.toLowerCase()}`);
      const progress = progressMap.get(id);
      const known = progress ? !!progress.known : false;

      cards.push({
        id,
        topic,
        term,
        definition,
        known,
      });
    }

    return cards;
  }

  // ---------------------------------------------------------------------------
  // Filters, shuffle, and rendering
  // ---------------------------------------------------------------------------

  function rebuildWorkingSet() {
    // Start from all cards; shuffle if enabled
    let working = state.cards.slice();
    if (state.shuffleEnabled) {
      working = shuffleArray(working);
    }
    state.filteredCards = working;
  }

  function buildTopicFilterOptions() {
    const topics = new Set();
    state.cards.forEach((card) => {
      if (card.topic) topics.add(card.topic);
    });

    const current = state.selectedTopic;

    els.topicFilter.innerHTML = '';
    const allOpt = document.createElement('option');
    allOpt.value = '';
    allOpt.textContent = 'All topics';
    els.topicFilter.appendChild(allOpt);

    Array.from(topics)
      .sort((a, b) => a.localeCompare(b))
      .forEach((topic) => {
        const opt = document.createElement('option');
        opt.value = topic;
        opt.textContent = topic;
        els.topicFilter.appendChild(opt);
      });

    // Restore previously selected topic if still valid
    if (current && current !== 'ALL') {
      const option = Array.from(els.topicFilter.options).find(
        (o) => o.value === current
      );
      els.topicFilter.value = option ? current : '';
      state.selectedTopic = option ? current : 'ALL';
    } else {
      els.topicFilter.value = '';
      state.selectedTopic = 'ALL';
    }
  }

  function applyFilters() {
    let cards = state.cards.slice();

    if (state.shuffleEnabled) {
      cards = shuffleArray(cards);
    }

    if (state.selectedTopic && state.selectedTopic !== 'ALL') {
      cards = cards.filter((c) => c.topic === state.selectedTopic);
    }

    if (state.unknownOnly) {
      cards = cards.filter((c) => !c.known);
    }

    state.filteredCards = cards;

    if (state.currentIndex >= cards.length) {
      state.currentIndex = cards.length > 0 ? cards.length - 1 : 0;
    }

    state.isFlipped = false;
    renderCard();
  }

  function renderCard() {
    const hasCards = state.filteredCards.length > 0;
    const card = hasCards ? state.filteredCards[state.currentIndex] : null;

    if (!hasCards || !card) {
      els.topicLabel.textContent = 'No cards';
      els.cardFrontText.textContent = 'No cards to show.';
      els.cardBackText.textContent = 'Adjust your filters or load a deck.';
      els.counter.textContent = '0 / 0';
      els.card.classList.remove('flipped', 'known', 'unknown');
      return;
    }

    els.topicLabel.textContent = card.topic || 'Uncategorized';
    els.cardFrontText.textContent = card.term;
    els.cardBackText.textContent = card.definition;
    els.counter.textContent = `${state.currentIndex + 1} / ${state.filteredCards.length}`;

    if (state.isFlipped) {
      els.card.classList.add('flipped');
    } else {
      els.card.classList.remove('flipped');
    }

    els.card.classList.toggle('known', !!card.known);
    els.card.classList.toggle('unknown', !card.known);
  }

  // ---------------------------------------------------------------------------
  // Card interactions
  // ---------------------------------------------------------------------------

  function flipCard() {
    if (!state.filteredCards.length) return;
    state.isFlipped = !state.isFlipped;
    renderCard();
  }

  function nextCard() {
    if (!state.filteredCards.length) return;
    state.currentIndex =
      (state.currentIndex + 1) % Math.max(state.filteredCards.length, 1);
    state.isFlipped = false;
    renderCard();
  }

  function prevCard() {
    if (!state.filteredCards.length) return;
    state.currentIndex =
      (state.currentIndex - 1 + state.filteredCards.length) %
      Math.max(state.filteredCards.length, 1);
    state.isFlipped = false;
    renderCard();
  }

  function setKnownState(isKnown) {
    if (!state.filteredCards.length || !state.currentDeck) return;
    const card = state.filteredCards[state.currentIndex];
    if (!card) return;

    card.known = !!isKnown;

    // Update original cards array
    const idx = state.cards.findIndex((c) => c.id === card.id);
    if (idx !== -1) {
      state.cards[idx].known = card.known;
    }

    state.cardProgressMap.set(card.id, { known: card.known });
    saveCardProgressForCurrentDeck().catch((err) =>
      console.error('Failed to save progress', err)
    );

    renderCard();
  }

  // ---------------------------------------------------------------------------
  // Settings helpers
  // ---------------------------------------------------------------------------

  function applySettings(settings) {
    if (!settings) return;
    state.shuffleEnabled = !!settings.shuffleEnabled;
    state.unknownOnly = !!settings.filterUnknownOnly;
    state.selectedTopic = settings.selectedTopic || 'ALL';
    applySettingsToControls();
  }

  function applySettingsToControls() {
    els.shuffleToggle.checked = !!state.shuffleEnabled;
    els.unknownOnlyToggle.checked = !!state.unknownOnly;
    // topic dropdown is wired during buildTopicFilterOptions
  }

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  function hashString(str) {
    // Simple 32-bit hash
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0; // Convert to 32bit integer
    }
    return `c_${Math.abs(hash)}`;
  }

  function shuffleArray(arr) {
    const copy = arr.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function showToast(message) {
    if (!els.toast) return;
    els.toast.textContent = message;
    els.toast.classList.add('show');
    window.clearTimeout(showToast._timeout);
    showToast._timeout = window.setTimeout(() => {
      els.toast.classList.remove('show');
    }, 3000);
  }
})();

