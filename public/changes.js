(function () {
  var ICONS = {
    history: '<path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><polyline points="12 7 12 12 16 14"/>',
    arrowLeft: '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>',
    sun: '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>',
    moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
    filePlus: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/>',
    fileMinus: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="15" x2="15" y2="15"/>',
    pencil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>',
    chevron: '<polyline points="9 18 15 12 9 6"/>',
    search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    expand: '<polyline points="7 13 12 18 17 13"/><polyline points="7 6 12 11 17 6"/>',
    collapse: '<polyline points="17 11 12 6 7 11"/><polyline points="17 18 12 13 7 18"/>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    alert: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>'
  };

  var vaultSelector = document.getElementById('vault-selector');
  var entryList = document.getElementById('entry-list');
  var detail = document.getElementById('detail');
  var token = readToken();
  var currentPrefix = '';
  var currentEntry = null;
  var filterText = '';

  setupHeader();
  loadVaults();

  function setupHeader() {
    var badge = document.getElementById('page-badge');
    badge.appendChild(createIcon('history'));
    badge.appendChild(createText('span', 'Änderungen'));

    var chatButton = document.getElementById('btn-chat');
    chatButton.appendChild(createIcon('arrowLeft'));
    chatButton.appendChild(createText('span', 'Zum Chat'));

    var themeButton = document.getElementById('btn-theme');
    themeButton.addEventListener('click', function () {
      var isLight = document.documentElement.getAttribute('data-theme') === 'light';
      var nextTheme = isLight ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', nextTheme);
      try { localStorage.setItem('theme', nextTheme); } catch (e) {}
      updateThemeButton(themeButton);
    });
    updateThemeButton(themeButton);
  }

  function updateThemeButton(button) {
    var isLight = document.documentElement.getAttribute('data-theme') === 'light';
    clear(button);
    button.appendChild(createIcon(isLight ? 'moon' : 'sun'));
    button.title = isLight ? 'Dark Mode' : 'Light Mode';
  }

  function loadVaults() {
    apiGet('/api/vaults').then(function (data) {
      if (!data) return;
      if (data.vaults.length === 0) {
        showState(detail, 'alert', 'Keine Vaults', 'Der Server hat keine Vaults geladen.');
        return;
      }
      for (var i = 0; i < data.vaults.length; i++) {
        vaultSelector.appendChild(createVaultSegment(data.vaults[i]));
      }
      vaultSelector.classList.remove('hidden');
      vaultSelector.firstChild.click();
    });
  }

  function createVaultSegment(vault) {
    var button = document.createElement('button');
    button.className = 'vault-segment';
    button.textContent = vault.name;
    button.addEventListener('click', function () {
      var active = vaultSelector.querySelector('.vault-segment.active');
      if (active) active.classList.remove('active');
      button.classList.add('active');
      loadEntries(vault.toolPrefix);
    });
    return button;
  }

  function loadEntries(prefix) {
    currentPrefix = prefix;
    clear(entryList);
    clear(detail);
    apiGet('/api/' + prefix + '/changes').then(function (data) {
      if (!data) return;
      if (!data.enabled) {
        showSidebarNote('Verlauf deaktiviert.');
        showState(detail, 'alert', 'Änderungsverlauf ist nicht aktiviert', 'Setze auf dem Server die Umgebungsvariable DATA_DIR und mounte dafür ein Volume.');
        return;
      }
      if (data.entries.length === 0) {
        showSidebarNote('Noch keine Einträge.');
        showState(detail, 'history', 'Noch keine Änderungen', 'Der Verlauf beginnt mit dem nächsten Deploy, bei dem sich der Inhalt dieses Vaults ändert.');
        return;
      }
      for (var i = 0; i < data.entries.length; i++) {
        entryList.appendChild(createEntryButton(data.entries[i]));
      }
      entryList.firstChild.click();
    });
  }

  function createEntryButton(entry) {
    var button = document.createElement('button');
    button.className = 'entry';
    button.appendChild(createText('div', formatDate(entry.at), 'entry-date'));
    button.appendChild(createText('div', formatRelative(entry.at), 'entry-relative'));

    var chips = document.createElement('div');
    chips.className = 'chips';
    chips.appendChild(createChip('added', 'filePlus', entry.added.length));
    chips.appendChild(createChip('changed', 'pencil', entry.changed.length));
    chips.appendChild(createChip('removed', 'fileMinus', entry.removed.length));
    button.appendChild(chips);

    button.addEventListener('click', function () {
      var active = entryList.querySelector('.entry.active');
      if (active) active.classList.remove('active');
      button.classList.add('active');
      loadEntry(entry.id);
    });
    return button;
  }

  function createChip(kind, icon, count) {
    var chip = document.createElement('span');
    chip.className = 'chip ' + kind;
    chip.appendChild(createIcon(icon));
    chip.appendChild(document.createTextNode(String(count)));
    return chip;
  }

  function loadEntry(id) {
    var prefix = currentPrefix;
    apiGet('/api/' + prefix + '/changes/' + encodeURIComponent(id)).then(function (entry) {
      if (!entry || prefix !== currentPrefix) return;
      currentEntry = entry;
      filterText = '';
      renderEntry();
    });
  }

  function renderEntry() {
    clear(detail);
    detail.scrollTop = 0;

    var head = document.createElement('div');
    head.className = 'detail-head';
    var titleBox = document.createElement('div');
    titleBox.appendChild(createText('h2', formatDate(currentEntry.at)));
    titleBox.appendChild(createText('div', formatRelative(currentEntry.at), 'sub'));
    head.appendChild(titleBox);
    detail.appendChild(head);

    var tiles = document.createElement('div');
    tiles.className = 'tiles';
    tiles.appendChild(createTile('added', 'filePlus', currentEntry.added.length, 'Neue Seiten'));
    tiles.appendChild(createTile('changed', 'pencil', currentEntry.changed.length, 'Geänderte Seiten'));
    tiles.appendChild(createTile('removed', 'fileMinus', currentEntry.removed.length, 'Entfernte Seiten'));
    detail.appendChild(tiles);

    detail.appendChild(createToolbar());

    var groups = document.createElement('div');
    groups.id = 'groups';
    detail.appendChild(groups);
    renderGroups();
  }

  function createTile(kind, icon, count, label) {
    var tile = document.createElement('div');
    tile.className = 'tile ' + kind;
    var iconWrap = document.createElement('div');
    iconWrap.className = 'icon-wrap';
    iconWrap.appendChild(createIcon(icon));
    var text = document.createElement('div');
    text.appendChild(createText('div', String(count), 'tile-count'));
    text.appendChild(createText('div', label, 'tile-label'));
    tile.appendChild(iconWrap);
    tile.appendChild(text);
    return tile;
  }

  function createToolbar() {
    var toolbar = document.createElement('div');
    toolbar.className = 'toolbar';

    var searchBox = document.createElement('label');
    searchBox.className = 'search-box';
    searchBox.appendChild(createIcon('search'));
    var input = document.createElement('input');
    input.type = 'search';
    input.placeholder = 'Seiten filtern';
    input.addEventListener('input', function () {
      filterText = input.value.trim().toLowerCase();
      renderGroups();
    });
    searchBox.appendChild(input);
    toolbar.appendChild(searchBox);

    toolbar.appendChild(createToolbarButton('expand', 'Alle öffnen', function () { setAllOpen(true); }));
    toolbar.appendChild(createToolbarButton('collapse', 'Alle schließen', function () { setAllOpen(false); }));
    return toolbar;
  }

  function createToolbarButton(icon, label, onClick) {
    var button = document.createElement('button');
    button.className = 'header-btn';
    button.title = label;
    button.appendChild(createIcon(icon));
    button.appendChild(createText('span', label));
    button.addEventListener('click', onClick);
    return button;
  }

  function setAllOpen(open) {
    var files = document.querySelectorAll('details.file');
    for (var i = 0; i < files.length; i++) files[i].open = open;
  }

  function renderGroups() {
    var groups = document.getElementById('groups');
    clear(groups);

    var added = filterPaths(currentEntry.added);
    var removed = filterPaths(currentEntry.removed);
    var changed = [];
    for (var i = 0; i < currentEntry.changed.length; i++) {
      if (matchesFilter(currentEntry.changed[i].path)) changed.push(currentEntry.changed[i]);
    }

    if (added.length + removed.length + changed.length === 0) {
      showState(groups, 'search', 'Keine Treffer', 'Kein Dateipfad enthält diesen Filter.');
      return;
    }

    if (added.length > 0) groups.appendChild(createPathGroup('added', 'filePlus', 'Neue Seiten', added));
    if (changed.length > 0) groups.appendChild(createChangedGroup(changed));
    if (removed.length > 0) groups.appendChild(createPathGroup('removed', 'fileMinus', 'Entfernte Seiten', removed));
  }

  function createPathGroup(kind, icon, title, paths) {
    var group = createGroup(kind, icon, title, paths.length);
    for (var i = 0; i < paths.length; i++) {
      var row = document.createElement('div');
      row.className = 'path-row ' + kind;
      row.appendChild(createIcon(icon));
      row.appendChild(createText('span', paths[i]));
      group.appendChild(row);
    }
    return group;
  }

  function createChangedGroup(files) {
    var group = createGroup('changed', 'pencil', 'Geänderte Seiten', files.length);
    for (var i = 0; i < files.length; i++) {
      group.appendChild(createFileBlock(files[i], currentEntry.diffs[files[i].path]));
    }
    return group;
  }

  function createGroup(kind, icon, title, count) {
    var group = document.createElement('div');
    group.className = 'group';
    var heading = document.createElement('div');
    heading.className = 'group-title ' + kind;
    heading.appendChild(createIcon(icon));
    heading.appendChild(document.createTextNode(title + ' (' + count + ')'));
    group.appendChild(heading);
    return group;
  }

  function createFileBlock(file, diff) {
    var block = document.createElement('details');
    block.className = 'file';

    var summary = document.createElement('summary');
    var chevron = createIcon('chevron');
    chevron.classList.add('chevron');
    summary.appendChild(chevron);
    summary.appendChild(createText('span', file.path, 'path'));
    summary.appendChild(createText('span', '+' + file.additions, 'stat plus'));
    summary.appendChild(createText('span', '-' + file.deletions, 'stat minus'));
    block.appendChild(summary);

    // diff lines are only built when the block is opened for the first time
    var built = false;
    block.addEventListener('toggle', function () {
      if (!block.open || built) return;
      built = true;
      block.appendChild(createDiffBody(diff));
    });
    return block;
  }

  function createDiffBody(diff) {
    var body = document.createElement('div');
    body.className = 'diff';
    var lines = diff ? diff.lines : [];
    for (var i = 0; i < lines.length; i++) {
      body.appendChild(createDiffLine(lines[i]));
    }
    if (diff && diff.truncated) {
      body.appendChild(createText('div', 'Diff gekürzt, weitere Änderungen werden nicht angezeigt.', 'line-note'));
    }
    return body;
  }

  function createDiffLine(line) {
    var element = document.createElement('div');
    element.textContent = line;
    if (line.indexOf('@@') === 0) element.className = 'line-hunk';
    else if (line.charAt(0) === '+') element.className = 'line-add';
    else if (line.charAt(0) === '-') element.className = 'line-del';
    return element;
  }

  function filterPaths(paths) {
    var result = [];
    for (var i = 0; i < paths.length; i++) {
      if (matchesFilter(paths[i])) result.push(paths[i]);
    }
    return result;
  }

  function matchesFilter(path) {
    return !filterText || path.toLowerCase().indexOf(filterText) !== -1;
  }

  function apiGet(url) {
    var headers = {};
    if (token) headers.Authorization = 'Bearer ' + token;
    return fetch(url, { headers: headers }).then(function (response) {
      if (response.status === 401) {
        askForToken();
        return null;
      }
      if (!response.ok) {
        showState(detail, 'alert', 'Fehler beim Laden', 'Der Server antwortete mit Status ' + response.status + '.');
        return null;
      }
      return response.json();
    }).catch(function () {
      showState(detail, 'alert', 'Server nicht erreichbar', 'Prüfe die Verbindung und lade die Seite neu.');
      return null;
    });
  }

  function askForToken() {
    clear(entryList);
    showState(detail, 'lock', 'API Token erforderlich', 'Der Server verlangt einen Token, um den Verlauf anzuzeigen.');
    var box = document.createElement('div');
    box.className = 'token-box';
    var input = document.createElement('input');
    input.type = 'password';
    input.placeholder = 'API_TOKEN';
    var button = document.createElement('button');
    button.textContent = 'Weiter';
    button.addEventListener('click', function () {
      token = input.value.trim();
      try { sessionStorage.setItem('docsvaultToken', token); } catch (e) {}
      window.location.reload();
    });
    box.appendChild(input);
    box.appendChild(button);
    detail.firstChild.appendChild(box);
  }

  function readToken() {
    try { return sessionStorage.getItem('docsvaultToken') || ''; } catch (e) { return ''; }
  }

  function showState(container, icon, title, message) {
    clear(container);
    var state = document.createElement('div');
    state.className = 'state';
    var big = createIcon(icon);
    state.appendChild(big);
    state.appendChild(createText('h2', title));
    state.appendChild(createText('p', message));
    container.appendChild(state);
  }

  function showSidebarNote(message) {
    clear(entryList);
    entryList.appendChild(createText('div', message, 'sidebar-note'));
  }

  // icon markup comes from the constant table above, never from server data
  function createIcon(name) {
    var template = document.createElement('template');
    template.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">' + ICONS[name] + '</svg>';
    return template.content.firstChild;
  }

  function createText(tag, text, className) {
    var element = document.createElement(tag);
    element.textContent = text;
    if (className) element.className = className;
    return element;
  }

  function clear(element) {
    while (element.firstChild) element.removeChild(element.firstChild);
  }

  function formatDate(iso) {
    return new Date(iso).toLocaleString('de-DE', { dateStyle: 'long', timeStyle: 'short' });
  }

  function formatRelative(iso) {
    var seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
    var formatter = new Intl.RelativeTimeFormat('de', { numeric: 'auto' });
    var units = [['day', 86400], ['hour', 3600], ['minute', 60]];
    for (var i = 0; i < units.length; i++) {
      if (Math.abs(seconds) >= units[i][1]) return formatter.format(Math.round(seconds / units[i][1]), units[i][0]);
    }
    return formatter.format(seconds, 'second');
  }
})();
