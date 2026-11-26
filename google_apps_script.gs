/**
 * Course Registration — Google Sheet + Drive backend (Google Apps Script)
 *
 * SETUP (about 5 minutes)
 *  1. Create a new Google Sheet (e.g. "Course Registrations").
 *  2. In the Sheet: Extensions → Apps Script. Delete the sample code, paste this whole file, click Save.
 *  3. Deploy → New deployment → type "Web app".
 *       Execute as: Me      Who has access: Anyone
 *     Click Deploy, allow the permissions, and copy the "Web app URL" (ends with /exec).
 *  4. Paste that URL into index.html:   var GAS_URL='https://script.google.com/macros/s/…/exec';
 *
 * Data
 *  - Registrations: sheet "Registrations" in this spreadsheet (one row per student).
 *  - Screenshots: Drive folder "Course Registration Screenshots" (private to you).
 *  - Student passwords arrive already salted + hashed from the page; this script never sees a password.
 *  - Admin login: the same default username/password as the page's browser mode → change it from the admin page (Settings).
 */

var SHEET_NAME = 'Registrations';
var FOLDER_NAME = 'Course Registration Screenshots';
var HEADERS = ['Ref No','Submitted At','Course','Mapped Google Course','Full Name','Email','Contact Number','Gender','Year Of Graduation',
  'Organisation','Profile URL','Profile Name','Profile Badges','Email Check','Profile Link Check','Screenshot Check',
  'Verification Screenshot','Profile Screenshot','Verification Status','Reviewed At','Admin Note',
  'Badge Status','Badges Done','Badges Required','Badge Checked At','Password Hash','Created'];
var ADMIN_EDITABLE = ['Verification Status','Reviewed At','Admin Note','Badge Status','Badges Done','Badges Required','Badge Checked At'];
var DEFAULT_ADMIN = { user: 'admin', hash: '5c453d5965b9f0e7428eb5e424214a9a8afc345bcaa32d139c38ce8e1bdc4458' }; // default admin login (hash only)
var MAX_IMAGE_B64 = 8 * 1024 * 1024;     // ~6 MB image
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

/* ---------------- HTTP ---------------- */
function doGet() { return out({ ok: true, service: 'course-registration', time: new Date().toISOString() }); }
function doPost(e) {
  var req = {};
  try { req = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { return out({ ok: false, error: 'Bad request' }); }
  var fn = ACTIONS[req.action];
  if (!fn) return out({ ok: false, error: 'Unknown action' });
  try { return out(fn(req)); }
  catch (err) { return out({ ok: false, error: String((err && err.message) || err) }); }
}
function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

/* ---------------- storage helpers ---------------- */
function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  var head = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0] : [];
  var missing = HEADERS.filter(function (h) { return head.indexOf(h) < 0; });
  if (missing.length) {
    sh.getRange(1, head.length + 1, 1, missing.length).setValues([missing]);
    sh.setFrozenRows(1);
  }
  return sh;
}
function headers_(sh) { return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]; }
function rows_(sh) {
  var n = sh.getLastRow() - 1; if (n < 1) return [];
  var h = headers_(sh), vals = sh.getRange(2, 1, n, h.length).getValues();
  return vals.map(function (v, i) { var o = { _row: i + 2 }; h.forEach(function (k, j) { o[k] = v[j] instanceof Date ? v[j].toISOString() : v[j]; }); return o; });
}
function folder_() {
  var p = PropertiesService.getScriptProperties(), id = p.getProperty('FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  var f = DriveApp.createFolder(FOLDER_NAME); p.setProperty('FOLDER_ID', f.getId()); return f;
}
function norm_(s) { return String(s || '').trim().toLowerCase(); }
function profileKey_(url) { var m = String(url || '').match(/\/public_profiles\/([A-Za-z0-9-]{8,64})/); return m ? m[1].toLowerCase() : ''; }
function hex_(bytes) { return bytes.map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join(''); }
function sha256_(s) { return hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)); }
function conflict_(rows, email, profile) {
  var em = norm_(email), pk = profileKey_(profile);
  if (em && rows.some(function (r) { return norm_(r['Email']) === em; })) return 'email';
  if (pk && rows.some(function (r) { return profileKey_(r['Profile URL']) === pk; })) return 'profile';
  return null;
}

/* ---------------- admin auth (token kept 6 h) ---------------- */
function admin_() {
  var p = PropertiesService.getScriptProperties();
  return { user: p.getProperty('ADMIN_USER') || DEFAULT_ADMIN.user, hash: p.getProperty('ADMIN_HASH') || DEFAULT_ADMIN.hash };
}
function requireAdmin_(req) {
  var u = req.token && CacheService.getScriptCache().get('tok_' + req.token);
  if (!u) throw new Error('AUTH');
  CacheService.getScriptCache().put('tok_' + req.token, u, 21600);
  return u;
}

/* ---------------- public profile reading (fast, in parallel) ---------------- */
function decode_(s) {
  return String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'")
    .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(+n); }).replace(/\s+/g, ' ').trim();
}
function parseProfile_(html, url) {
  var t = (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '';
  var nm = decode_(t).match(/^(.*?)\s*\|\s*Google Skills\s*$/i);
  if (!nm || !nm[1] || html.indexOf('/public_profiles/') < 0) return { url: url, ok: false, reason: 'not_found', message: 'This profile does not open. It may be wrong, or not made public yet.' };
  var list = [], seen = {}, re = /\/public_profiles\/[A-Za-z0-9-]+\/badges\/(\d+)"[\s\S]*?<span class='ql-title-medium[^']*'>([\s\S]*?)<\/span>\s*<span class='ql-body-medium[^']*'>\s*Earned\s+([^<]*?)\s*<\/span>/g, m;
  while ((m = re.exec(html))) { if (seen[m[1]]) continue; seen[m[1]] = 1; list.push({ id: m[1], name: decode_(m[2]), date: decode_(m[3]).replace(/\s+[A-Z]{2,4}$/, '') }); }
  return { url: url, ok: true, name: decode_(nm[1]), badges: list.length, list: list };
}
function canonical_(raw) {
  var m = String(raw || '').match(/^https?:\/\/(?:www\.)?(?:skills\.google|cloudskillsboost\.google)\/public_profiles\/([A-Za-z0-9-]{8,64})\/?(?:[?#].*)?$/i);
  return m ? 'https://www.skills.google/public_profiles/' + m[1] : null;
}
function readProfiles_(urls) {
  var reqs = [], idx = [], results = urls.map(function (u, i) {
    var c = canonical_(u); if (!c) return { url: u, ok: false, reason: 'invalid', message: 'Not a Google Skills public profile link.' };
    reqs.push({ url: c, muteHttpExceptions: true, followRedirects: true, headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'en-US,en;q=0.9' } }); idx.push(i); return null;
  });
  if (reqs.length) {
    var res = UrlFetchApp.fetchAll(reqs);
    res.forEach(function (r, k) {
      var i = idx[k], code = r.getResponseCode();
      results[i] = code === 200 ? parseProfile_(r.getContentText(), reqs[k].url)
        : { url: reqs[k].url, ok: false, reason: code >= 500 || code === 429 ? 'unreachable' : 'not_found', message: code >= 500 || code === 429 ? 'Google Skills is busy, try again.' : 'This profile does not open. It may be wrong, or not made public yet.' };
    });
  }
  return results;
}

/* ---------------- actions ---------------- */
var ACTIONS = {
  ping: function () { return { ok: true }; },

  /* public: is this email ID or profile link already registered? */
  conflict: function (req) { return { ok: true, conflict: conflict_(rows_(sheet_()), req.email, req.profile) }; },

  /* public: read up to 5 profiles (admins: up to 60 per call) */
  profiles: function (req) {
    var urls = (req.urls || []).slice(0, 60), isAdmin = false;
    try { requireAdmin_(req); isAdmin = true; } catch (e) {}
    if (!isAdmin) urls = urls.slice(0, 5);
    return { ok: true, results: readProfiles_(urls) };
  },

  /* public: add a verified registration with its two screenshots */
  register: function (req) {
    var rec = req.rec || {}, email = String(rec['Email'] || '').trim(), url = canonical_(rec['Profile URL']);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new Error('Invalid email ID');
    if (!url) throw new Error('Invalid public profile link');
    ['Ref No', 'Course', 'Full Name', 'Organisation'].forEach(function (k) { if (!String(rec[k] || '').trim()) throw new Error('Missing ' + k); });
    if (!req.shot1 || !req.shot2) throw new Error('Both screenshots are required');
    if (req.shot1.length > MAX_IMAGE_B64 || req.shot2.length > MAX_IMAGE_B64) throw new Error('Screenshot too large');
    var lock = LockService.getScriptLock(); lock.waitLock(25000);
    try {
      var sh = sheet_(), c = conflict_(rows_(sh), email, url);
      if (c) return { ok: false, error: 'DUP', dup: c };
      var f = folder_(), ref = String(rec['Ref No']).replace(/[^A-Za-z0-9-]/g, '');
      var f1 = f.createFile(Utilities.newBlob(Utilities.base64Decode(req.shot1), 'image/jpeg', ref + '.jpg'));
      var f2 = f.createFile(Utilities.newBlob(Utilities.base64Decode(req.shot2), 'image/jpeg', ref + '-profile.jpg'));
      var row = {};
      HEADERS.forEach(function (h) { row[h] = rec[h] == null ? '' : rec[h]; });
      row['Ref No'] = ref; row['Email'] = email; row['Profile URL'] = url;
      row['Verification Screenshot'] = f1.getId(); row['Profile Screenshot'] = f2.getId();
      row['Verification Status'] = 'Verified'; row['Reviewed At'] = 'Auto-verified on submit'; row['Admin Note'] = '';
      row['Badge Status'] = ''; row['Badges Done'] = ''; row['Badges Required'] = ''; row['Badge Checked At'] = '';
      row['Password Hash'] = /^sha256\$[0-9a-f]{32}\$[0-9a-f]{64}$/.test(String(rec['Password Hash'] || '')) ? rec['Password Hash'] : '';
      row['Created'] = new Date().toISOString();
      row['Submitted At'] = rec['Submitted At'] || row['Created'];
      var h = headers_(sh); sh.appendRow(h.map(function (k) { return row[k] == null ? '' : row[k]; }));
      return { ok: true, ref: ref };
    } finally { lock.releaseLock(); }
  },

  /* admin */
  login: function (req) {
    var cache = CacheService.getScriptCache(), fails = +(cache.get('fails') || 0);
    if (fails >= 10) throw new Error('Too many wrong attempts. Try again in 10 minutes.');
    var a = admin_();
    if (String(req.user || '') !== a.user || sha256_('cr-admin|' + req.user + '|' + (req.pass || '')) !== a.hash) {
      cache.put('fails', String(fails + 1), 600); throw new Error('Incorrect username or password.');
    }
    var token = Utilities.getUuid() + Utilities.getUuid(); cache.put('tok_' + token, a.user, 21600);
    return { ok: true, token: token, user: a.user };
  },
  logout: function (req) { if (req.token) CacheService.getScriptCache().remove('tok_' + req.token); return { ok: true }; },
  list: function (req) {
    requireAdmin_(req);
    return { ok: true, rows: rows_(sheet_()).map(function (r) { var o = {}; Object.keys(r).forEach(function (k) { if (k !== '_row' && k !== 'Password Hash') o[k] = r[k]; }); o['Password Set'] = r['Password Hash'] ? 'Yes' : 'No'; return o; }) };
  },
  update: function (req) {
    requireAdmin_(req);
    var lock = LockService.getScriptLock(); lock.waitLock(25000);
    try {
      var sh = sheet_(), h = headers_(sh), refs = req.refs || [], patch = req.patch || {}, n = 0;
      rows_(sh).forEach(function (r) {
        if (refs.indexOf(String(r['Ref No'])) < 0) return;
        Object.keys(patch).forEach(function (k) { if (ADMIN_EDITABLE.indexOf(k) > -1) sh.getRange(r._row, h.indexOf(k) + 1).setValue(patch[k]); });
        n++;
      });
      return { ok: true, updated: n };
    } finally { lock.releaseLock(); }
  },
  remove: function (req) {
    requireAdmin_(req);
    var lock = LockService.getScriptLock(); lock.waitLock(25000);
    try {
      var sh = sheet_(), refs = req.all ? null : (req.refs || []), gone = 0;
      rows_(sh).reverse().forEach(function (r) {                       // bottom-up so row numbers stay valid
        if (refs && refs.indexOf(String(r['Ref No'])) < 0) return;
        ['Verification Screenshot', 'Profile Screenshot'].forEach(function (k) { if (r[k]) { try { DriveApp.getFileById(r[k]).setTrashed(true); } catch (e) {} } });
        sh.deleteRow(r._row); gone++;
      });
      return { ok: true, removed: gone };
    } finally { lock.releaseLock(); }
  },
  shot: function (req) {
    requireAdmin_(req);
    var r = rows_(sheet_()).filter(function (x) { return String(x['Ref No']) === String(req.ref); })[0];
    var id = r && r[req.which === 'profile' ? 'Profile Screenshot' : 'Verification Screenshot'];
    if (!id) return { ok: true, data: '' };
    var b = DriveApp.getFileById(id).getBlob();
    return { ok: true, data: Utilities.base64Encode(b.getBytes()), mime: b.getContentType() };
  },
  changePassword: function (req) {
    requireAdmin_(req);
    var a = admin_();
    if (sha256_('cr-admin|' + a.user + '|' + (req.old || '')) !== a.hash) return { ok: false, error: 'CUR' };
    if (String(req.pass || '').length < 8) throw new Error('New password must be at least 8 characters.');
    PropertiesService.getScriptProperties().setProperty('ADMIN_HASH', sha256_('cr-admin|' + a.user + '|' + req.pass));
    return { ok: true };
  }
};
