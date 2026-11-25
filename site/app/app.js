// Drive in the browser. No server of ours: the page talks to Google directly, with the person's own token.
// The token is kept in sessionStorage (this tab only) with its expiry, and never leaves the browser except to
// www.googleapis.com. Output is written with textContent only, never innerHTML.
(function () {
  'use strict';
  var cfg = window.DRIVE_CONFIG || {};
  var API = 'https://www.googleapis.com/drive/v3/';
  var UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
  var TOKEN_KEY = 'drive.token', PICKED_KEY = 'drive.picked';
  var FOLDER = 'application/vnd.google-apps.folder';
  var $ = function (id) { return document.getElementById(id); };

  function store(k, v) { try { if (v == null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) { mem[k] = v; } }
  function load(k) { try { var s = sessionStorage.getItem(k); return s ? JSON.parse(s) : (mem[k] || null); } catch (e) { return mem[k] || null; } }
  var mem = {};
  function token() { var t = load(TOKEN_KEY); return t && t.exp > Date.now() + 30000 ? t.value : null; }
  function status(msg, err) { var s = $('status'); if (!s) return; s.textContent = msg || ''; s.className = 'status' + (err ? ' err' : ''); }
  function script(src) { return new Promise(function (ok, no) { var s = document.createElement('script'); s.src = src; s.async = true; s.onload = ok; s.onerror = function () { no(new Error('Could not load ' + src)); }; document.head.appendChild(s); }); }
  function el(tag, text, cls) { var e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; }

  // ---------- connect ----------
  function connectPage() {
    $('scope').textContent = cfg.scope;
    var ready = !!cfg.clientId;
    $('notready').hidden = ready; $('connect').disabled = !ready;
    function show() { var on = !!token(); $('disconnect').hidden = !on; if (on) status('Connected. Go to Browse.'); }
    show();
    $('connect').addEventListener('click', function () {
      status('Opening Google sign-in...');
      script('https://accounts.google.com/gsi/client').then(function () {
        var tc = google.accounts.oauth2.initTokenClient({
          client_id: cfg.clientId, scope: cfg.scope,
          callback: function (r) {
            if (r.error) { status('Sign-in failed: ' + r.error, true); return; }
            store(TOKEN_KEY, { value: r.access_token, exp: Date.now() + (Number(r.expires_in) || 3600) * 1000 });
            location.href = '/app/browse/';
          },
          error_callback: function (e) { status('Sign-in did not complete: ' + (e && e.type || 'unknown'), true); }
        });
        tc.requestAccessToken({ prompt: '' });
      }).catch(function (e) { status(e.message, true); });
    });
    $('disconnect').addEventListener('click', function () {
      var t = token(); store(TOKEN_KEY, null); store(PICKED_KEY, null);
      var done = function () { show(); status('Disconnected.'); };
      if (t) script('https://accounts.google.com/gsi/client').then(function () { google.accounts.oauth2.revoke(t, done); }, done); else done();
    });
  }

  // ---------- Drive calls ----------
  function call(url, opts) {
    var t = token(); if (!t) { store(TOKEN_KEY, null); return Promise.reject(new Error('Your sign-in has ended. Connect again.')); }
    opts = opts || {}; opts.headers = Object.assign({ Authorization: 'Bearer ' + t }, opts.headers || {});
    return fetch(url, opts).then(function (r) {
      if (r.ok) return r;
      return r.text().then(function (b) { var m = ''; try { m = JSON.parse(b).error.message; } catch (e) { m = r.status + ''; } throw new Error(m); });
    });
  }
  var FIELDS = 'nextPageToken,files(id,name,mimeType,size,modifiedTime,webViewLink)';
  function list(q) {
    var u = API + 'files?pageSize=100&orderBy=folder,name&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=' + encodeURIComponent(FIELDS) + (q ? '&q=' + encodeURIComponent(q) : '');
    return call(u).then(function (r) { return r.json(); });
  }
  function meta(id) { return call(API + 'files/' + encodeURIComponent(id) + '?supportsAllDrives=true&fields=' + encodeURIComponent('id,name,mimeType,size,modifiedTime,webViewLink')).then(function (r) { return r.json(); }); }
  var NATIVE = { 'application/vnd.google-apps.document': 'application/pdf', 'application/vnd.google-apps.spreadsheet': 'application/pdf', 'application/vnd.google-apps.presentation': 'application/pdf', 'application/vnd.google-apps.drawing': 'image/png' };
  function content(f) {
    var id = encodeURIComponent(f.id);
    var u = NATIVE[f.mimeType] ? API + 'files/' + id + '/export?mimeType=' + encodeURIComponent(NATIVE[f.mimeType]) : API + 'files/' + id + '?alt=media&supportsAllDrives=true';
    return call(u).then(function (r) { return r.arrayBuffer(); }).then(function (b) { return { bytes: b, type: NATIVE[f.mimeType] || f.mimeType || 'application/octet-stream' }; });
  }
  function createFolder(name, parent) {
    var body = { name: name, mimeType: FOLDER }; if (parent) body.parents = [parent];
    return call(API + 'files?supportsAllDrives=true&fields=id,name', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(function (r) { return r.json(); });
  }
  function upload(file, parent) {
    var m = { name: file.name }; if (parent) m.parents = [parent];
    var b = '----drive' + Math.random().toString(36).slice(2);
    var body = new Blob(['--' + b + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n', JSON.stringify(m), '\r\n--' + b + '\r\nContent-Type: ' + (file.type || 'application/octet-stream') + '\r\n\r\n', file, '\r\n--' + b + '--']);
    return call(UPLOAD + '?uploadType=multipart&supportsAllDrives=true&fields=id,name', { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + b }, body: body }).then(function (r) { return r.json(); });
  }

  // ---------- browse ----------
  function size(n) { n = Number(n); if (!n && n !== 0) return ''; var u = ['B', 'KB', 'MB', 'GB'], i = 0; while (n >= 1024 && i < 3) { n /= 1024; i++; } return (i ? n.toFixed(1) : n) + ' ' + u[i]; }
  function when(s) { return s ? s.slice(0, 16).replace('T', ' ') : ''; }
  function kind(m) { return m === FOLDER ? 'Folder' : (m || '').indexOf('application/vnd.google-apps.') === 0 ? 'Google ' + m.split('.').pop() : (m || ''); }

  function browsePage() {
    if (!token()) { $('needs').hidden = false; return; }
    $('work').hidden = false;
    var path = []; // [{id,name}]
    var cur = function () { return path.length ? path[path.length - 1].id : null; };
    var mode = 'picked'; // picked | all | folder
    var pickedIds = function () { return load(PICKED_KEY) || []; };
    var blobUrl = null;

    function crumbs() {
      var c = $('crumbs'); c.textContent = '';
      var root = el('button', 'Top', 'quiet'); root.type = 'button'; root.addEventListener('click', function () { path = []; mode = 'picked'; render(); }); c.appendChild(root);
      path.forEach(function (p, i) { c.appendChild(el('span', '/')); var b = el('button', p.name, 'quiet'); b.type = 'button'; b.addEventListener('click', function () { path = path.slice(0, i + 1); mode = 'folder'; render(); }); c.appendChild(b); });
    }
    function row(f) {
      var tr = el('tr'), n = el('td', null, 'name');
      if (f.mimeType === FOLDER) { var b = el('button', f.name); b.type = 'button'; b.addEventListener('click', function () { path.push({ id: f.id, name: f.name }); mode = 'folder'; render(); }); n.appendChild(b); }
      else n.textContent = f.name;
      tr.appendChild(n); tr.appendChild(el('td', kind(f.mimeType))); tr.appendChild(el('td', size(f.size))); tr.appendChild(el('td', when(f.modifiedTime)));
      var a = el('td');
      if (f.mimeType !== FOLDER) {
        [['Preview', function () { preview(f); }], ['Download', function () { download(f); }]].forEach(function (x) { var bt = el('button', x[0], 'quiet'); bt.type = 'button'; bt.addEventListener('click', x[1]); a.appendChild(bt); a.appendChild(document.createTextNode(' ')); });
      }
      tr.appendChild(a); return tr;
    }
    function render() {
      crumbs(); status('Loading...');
      var tb = document.querySelector('#list tbody'); tb.textContent = '';
      var p;
      if (mode === 'folder') p = list("'" + cur() + "' in parents and trashed=false").then(function (r) { return r.files; });
      else if (mode === 'all') p = list('trashed=false').then(function (r) { return r.files; });
      else p = Promise.all(pickedIds().map(function (id) { return meta(id).catch(function () { return null; }); })).then(function (a) { return a.filter(Boolean); });
      p.then(function (files) {
        files.forEach(function (f) { tb.appendChild(row(f)); });
        status(files.length ? files.length + ' items.' : (mode === 'picked' ? 'Nothing picked yet. Use "Pick files or folders to use", or "Everything this app can see".' : 'Nothing here.'));
      }).catch(function (e) { status(e.message, true); });
    }
    function preview(f) {
      status('Loading preview...');
      content(f).then(function (c) {
        var box = $('pbody'); box.textContent = ''; if (blobUrl) URL.revokeObjectURL(blobUrl);
        $('ptitle').textContent = f.name; $('preview').hidden = false;
        var t = c.type.split(';')[0];
        if (/^image\/(png|jpeg|gif|webp)$/.test(t)) { blobUrl = URL.createObjectURL(new Blob([c.bytes], { type: t })); var i = el('img'); i.src = blobUrl; i.alt = f.name; box.appendChild(i); }
        else if (t === 'application/pdf') { blobUrl = URL.createObjectURL(new Blob([c.bytes], { type: t })); var fr = el('iframe'); fr.src = blobUrl; fr.title = f.name; box.appendChild(fr); }
        else if (/^text\//.test(t) || t === 'application/json') { var pre = el('pre'); pre.textContent = new TextDecoder().decode(c.bytes.slice(0, 200000)); box.appendChild(pre); }
        else box.appendChild(el('p', 'No inline preview for this type. Use Download.'));
        status(''); $('preview').scrollIntoView();
      }).catch(function (e) { status(e.message, true); });
    }
    function download(f) {
      status('Downloading...');
      content(f).then(function (c) {
        var ext = NATIVE[f.mimeType] ? (c.type === 'image/png' ? '.png' : '.pdf') : '';
        var u = URL.createObjectURL(new Blob([c.bytes], { type: 'application/octet-stream' })), a = el('a'); a.href = u; a.download = f.name + ext; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 5000); status('Downloaded ' + f.name + ext + '.');
      }).catch(function (e) { status(e.message, true); });
    }
    function needFolderMode() { if (mode === 'picked' || mode === 'all') return null; return cur(); }

    $('refresh').addEventListener('click', render);
    $('all').addEventListener('click', function () { path = []; mode = 'all'; render(); });
    $('mkdir').addEventListener('click', function () {
      var n = $('newname').value.trim(); if (!n) { status('Give the folder a name.', true); return; }
      createFolder(n, needFolderMode()).then(function (f) { if (mode === 'picked') store(PICKED_KEY, pickedIds().concat(f.id)); $('newname').value = ''; render(); }).catch(function (e) { status(e.message, true); });
    });
    $('upload').addEventListener('click', function () {
      var f = $('upfile').files[0]; if (!f) { status('Choose a file first.', true); return; }
      status('Uploading...');
      upload(f, needFolderMode()).then(function (r) { if (mode === 'picked') store(PICKED_KEY, pickedIds().concat(r.id)); $('upfile').value = ''; render(); }).catch(function (e) { status(e.message, true); });
    });
    $('pick').addEventListener('click', function () {
      if (!cfg.apiKey || !cfg.appId) { status('The Picker needs an API key and an app ID in config.js (see Google Cloud set-up).', true); return; }
      status('Opening the Google Picker...');
      script('https://apis.google.com/js/api.js').then(function () { return new Promise(function (ok) { gapi.load('picker', ok); }); }).then(function () {
        var v = new google.picker.DocsView().setIncludeFolders(true).setSelectFolderEnabled(true);
        new google.picker.PickerBuilder().addView(v).setOAuthToken(token()).setDeveloperKey(cfg.apiKey).setAppId(cfg.appId)
          .setCallback(function (d) {
            if (d.action === google.picker.Action.PICKED) { var ids = pickedIds(); d.docs.forEach(function (x) { if (ids.indexOf(x.id) < 0) ids.push(x.id); }); store(PICKED_KEY, ids); path = []; mode = 'picked'; render(); }
            else if (d.action === google.picker.Action.CANCEL) status('');
          }).build().setVisible(true);
      }).catch(function (e) { status(e.message, true); });
    });
    render();
  }

  var page = document.body.getAttribute('data-page');
  if (page === 'connect') connectPage(); else if (page === 'browse') browsePage();
})();
