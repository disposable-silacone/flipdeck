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
    viewMode: 'study', // 'study' | 'overview'
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
    els.topicFilter = document.getElementById('topicFilter');

    els.randomToggleBtn = document.getElementById('randomToggleBtn');
    els.unknownOnlyBtn = document.getElementById('unknownOnlyBtn');

    els.studyViewBtn = document.getElementById('studyViewBtn');
    els.overviewViewBtn = document.getElementById('overviewViewBtn');

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

    // Overview
    els.studySection = document.getElementById('studySection');
    els.overviewSection = document.getElementById('overviewSection');
    els.overviewDeckSelect = document.getElementById('overviewDeckSelect');
    els.metricTotalCards = document.getElementById('metricTotalCards');
    els.metricKnown = document.getElementById('metricKnown');
    els.metricUnknown = document.getElementById('metricUnknown');
    els.metricKnownPercent = document.getElementById('metricKnownPercent');
    els.topicStatsBody = document.getElementById('topicStatsBody');
    els.cardsTableBody = document.getElementById('cardsTableBody');
    els.resetStatsBtn = document.getElementById('resetStatsBtn');

    els.mainLayout = document.querySelector('.main-layout');
    els.deckPanelToggle = document.getElementById('deckPanelToggle');
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

    if (els.randomToggleBtn) {
      els.randomToggleBtn.addEventListener('click', () => {
        state.shuffleEnabled = !state.shuffleEnabled;
        applySettingsToControls();
        saveSettingsToDb();
        applyFilters();
      });
    }

    els.topicFilter.addEventListener('change', () => {
      const value = els.topicFilter.value;
      state.selectedTopic = value || 'ALL';
      saveSettingsToDb();
      applyFilters();
    });

    if (els.unknownOnlyBtn) {
      els.unknownOnlyBtn.addEventListener('click', () => {
        state.unknownOnly = !state.unknownOnly;
        applySettingsToControls();
        saveSettingsToDb();
        applyFilters();
      });
    }

    els.studyViewBtn.addEventListener('click', () => setViewMode('study'));
    els.overviewViewBtn.addEventListener('click', () => setViewMode('overview'));

    els.card.addEventListener('click', () => {
      flipCard();
    });

    els.card.addEventListener('keydown', (e) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        flipCard();
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        nextCard();
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        prevCard();
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setKnownState(true);
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setKnownState(false);
      }
    });

    els.flipBtn.addEventListener('click', () => flipCard());
    els.nextBtn.addEventListener('click', () => nextCard());
    els.prevBtn.addEventListener('click', () => prevCard());

    els.knownBtn.addEventListener('click', () => setKnownState(true));
    els.unknownBtn.addEventListener('click', () => setKnownState(false));

    els.saveDeckBtn.addEventListener('click', () => addDeck());
    els.deleteDeckBtn.addEventListener('click', () => deleteDeck());

    if (els.overviewDeckSelect) {
      els.overviewDeckSelect.addEventListener('change', () => {
        const deckId = els.overviewDeckSelect.value;
        if (!deckId) return;
        // This will also make it the active study deck
        loadDeck(deckId).then(() => {
          if (state.viewMode === 'overview') {
            renderOverview();
          }
        });
      });
    }

    if (els.resetStatsBtn) {
      els.resetStatsBtn.addEventListener('click', () => {
        resetCurrentDeckStats();
      });
    }

    if (els.deckPanelToggle && els.mainLayout) {
      els.deckPanelToggle.addEventListener('click', () => {
        const collapsed = els.mainLayout.classList.toggle('deck-panel-collapsed');
        els.deckPanelToggle.textContent = collapsed ? 'ADD decks' : 'Hide decks';
      });
      const initiallyCollapsed = els.mainLayout.classList.contains('deck-panel-collapsed');
      els.deckPanelToggle.textContent = initiallyCollapsed ? 'ADD decks' : 'Hide decks';
    }
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

    // Mirror decks into overview selector
    if (els.overviewDeckSelect) {
      els.overviewDeckSelect.innerHTML = '';
      const allPlaceholder = document.createElement('option');
      allPlaceholder.value = '';
      allPlaceholder.textContent = 'Select a deck…';
      els.overviewDeckSelect.appendChild(allPlaceholder);

      state.decks
        .slice()
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
        .forEach((deck) => {
          const opt = document.createElement('option');
          opt.value = deck.id;
          opt.textContent = deck.name;
          els.overviewDeckSelect.appendChild(opt);
        });
    }
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

    return Promise.all([
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
        // Sync overview deck selector with current deck
        if (els.overviewDeckSelect) {
          els.overviewDeckSelect.value = deck.id;
        }
        if (state.viewMode === 'overview') {
          renderOverview();
        }
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
  // Filters, random, and rendering
  // ---------------------------------------------------------------------------

  function rebuildWorkingSet() {
    // Start from all cards in their natural order
    state.filteredCards = state.cards.slice();
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

    if (state.viewMode === 'overview') {
      renderOverview();
    }
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
    state.currentIndex = getNextIndex();
    state.isFlipped = false;
    renderCard();
  }

  function prevCard() {
    if (!state.filteredCards.length) return;
    state.currentIndex = getPrevIndex();
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

    if (state.viewMode === 'overview') {
      renderOverview();
    }
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
    // topic dropdown is wired during buildTopicFilterOptions
    updateToggleButtons();
  }

  // ---------------------------------------------------------------------------
  // View mode & overview rendering
  // ---------------------------------------------------------------------------

  function setViewMode(mode) {
    if (mode !== 'study' && mode !== 'overview') return;
    state.viewMode = mode;

    if (mode === 'study') {
      els.studySection.classList.remove('hidden');
      els.overviewSection.classList.add('hidden');
      els.studyViewBtn.classList.add('active');
      els.overviewViewBtn.classList.remove('active');
    } else {
      els.studySection.classList.add('hidden');
      els.overviewSection.classList.remove('hidden');
      els.studyViewBtn.classList.remove('active');
      els.overviewViewBtn.classList.add('active');

      // Ensure overview selector matches current deck
      if (state.currentDeck && els.overviewDeckSelect) {
        els.overviewDeckSelect.value = state.currentDeck.id;
      }
      renderOverview();
    }
  }

  function renderOverview() {
    if (!state.currentDeck) {
      // Clear metrics and tables when no deck is selected
      setMetricText(0, 0, 0, 0);
      clearElement(els.topicStatsBody);
      clearElement(els.cardsTableBody);
      return;
    }

    const cards = state.cards;
    const total = cards.length;
    const knownCount = cards.filter((c) => c.known).length;
    const unknownCount = total - knownCount;
    const knownPercent = total ? Math.round((knownCount / total) * 100) : 0;

    setMetricText(total, knownCount, unknownCount, knownPercent);
    renderTopicStats(cards);
    renderCardsTable(cards);
  }

  function setMetricText(total, known, unknown, percent) {
    if (!els.metricTotalCards) return;
    els.metricTotalCards.textContent = String(total);
    els.metricKnown.textContent = String(known);
    els.metricUnknown.textContent = String(unknown);
    els.metricKnownPercent.textContent = `${percent}%`;
  }

  function renderTopicStats(cards) {
    if (!els.topicStatsBody) return;
    clearElement(els.topicStatsBody);

    const byTopic = new Map();
    cards.forEach((card) => {
      const topic = card.topic || 'Uncategorized';
      const entry = byTopic.get(topic) || { total: 0, known: 0 };
      entry.total += 1;
      if (card.known) entry.known += 1;
      byTopic.set(topic, entry);
    });

    const topics = Array.from(byTopic.entries()).sort(([a], [b]) =>
      a.localeCompare(b)
    );

    topics.forEach(([topic, stats]) => {
      const unknown = stats.total - stats.known;
      const percent = stats.total
        ? Math.round((stats.known / stats.total) * 100)
        : 0;

      const tr = document.createElement('tr');
      tr.classList.add('topic-row');
      tr.innerHTML = `
        <td>${escapeHtml(topic)}</td>
        <td>${stats.total}</td>
        <td>${stats.known}</td>
        <td>${unknown}</td>
        <td>${percent}%</td>
      `;
      tr.addEventListener('click', () => jumpToStudyForTopic(topic));
      els.topicStatsBody.appendChild(tr);
    });
  }

  function renderCardsTable(cards) {
    if (!els.cardsTableBody) return;
    clearElement(els.cardsTableBody);

    cards.forEach((card) => {
      const tr = document.createElement('tr');
      const badgeClass = card.known ? 'badge-known' : 'badge-unknown';
      const badgeText = card.known ? 'Known' : 'Unknown';

      tr.innerHTML = `
        <td>${escapeHtml(card.topic || 'Uncategorized')}</td>
        <td>${escapeHtml(card.term)}</td>
        <td>${escapeHtml(card.definition)}</td>
        <td><span class="${badgeClass}">${badgeText}</span></td>
      `;

      els.cardsTableBody.appendChild(tr);
    });
  }

  function jumpToStudyForTopic(topic) {
    // Switch to study view
    setViewMode('study');

    // Update topic filter
    state.selectedTopic = topic;
    if (els.topicFilter) {
      els.topicFilter.value = topic;
    }
    applyFilters();

    // Scroll to card section
    if (els.studySection && typeof els.studySection.scrollIntoView === 'function') {
      els.studySection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function resetCurrentDeckStats() {
    if (!state.currentDeck) {
      showToast('No deck selected.');
      return;
    }

    const confirmed = window.confirm(
      'Reset all Known/Unknown stats for this deck? This cannot be undone.'
    );
    if (!confirmed) return;

    const deckId = state.currentDeck.id;

    // Clear progress in IndexedDB for this deck
    deleteProgressForDeckFromDb(deckId)
      .then(() => {
        // Reset in-memory state
        state.cards.forEach((card) => {
          card.known = false;
        });
        state.filteredCards.forEach((card) => {
          card.known = false;
        });
        state.cardProgressMap.clear();

        // Persist reset state (optional but keeps stores in sync)
        return saveCardProgressForCurrentDeck();
      })
      .then(() => {
        renderCard();
        if (state.viewMode === 'overview') {
          renderOverview();
        }
        showToast('Deck stats reset.');
      })
      .catch((err) => {
        console.error('Failed to reset stats', err);
        showToast('Failed to reset stats. Check console for details.');
      });
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

  function getNextIndex() {
    const len = state.filteredCards.length;
    if (!len) return 0;

    if (!state.shuffleEnabled) {
      return (state.currentIndex + 1) % len;
    }

    // Random mode: pick a random index, try to avoid repeating the same card
    let next = Math.floor(Math.random() * len);
    if (len > 1 && next === state.currentIndex) {
      next = (next + 1) % len;
    }
    return next;
  }

  function getPrevIndex() {
    const len = state.filteredCards.length;
    if (!len) return 0;

    if (!state.shuffleEnabled) {
      return (state.currentIndex - 1 + len) % len;
    }

    // In random mode, previous also just jumps to another random card
    let prev = Math.floor(Math.random() * len);
    if (len > 1 && prev === state.currentIndex) {
      prev = (prev + 1) % len;
    }
    return prev;
  }

  function clearElement(node) {
    if (!node) return;
    while (node.firstChild) {
      node.removeChild(node.firstChild);
    }
  }

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
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

  function updateToggleButtons() {
    if (els.randomToggleBtn) {
      const randomOn = !!state.shuffleEnabled;
      els.randomToggleBtn.classList.toggle('is-on', randomOn);
      const span = els.randomToggleBtn.querySelector('.toggle-state');
      if (span) {
        span.textContent = randomOn ? 'On' : 'Off';
      }
    }

    if (els.unknownOnlyBtn) {
      const unknownOn = !!state.unknownOnly;
      els.unknownOnlyBtn.classList.toggle('is-on', unknownOn);
      const span = els.unknownOnlyBtn.querySelector('.toggle-state');
      if (span) {
        span.textContent = unknownOn ? 'On' : 'Off';
      }
    }
  }
})();

