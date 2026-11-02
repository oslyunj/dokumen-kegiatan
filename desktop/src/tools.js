// Pengganti konektor Gmail dan Google Drive yang dipakai halaman aplikasi.
// Bentuk masukan dan keluaran (payload) dibuat sama dengan versi claude.ai.
const crypto = require('crypto');
const { GError } = require('./google');

const GOOGLE_TYPE = {
  'text/html': 'application/vnd.google-apps.document',
  'text/plain': 'application/vnd.google-apps.document',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'application/vnd.google-apps.document',
  'text/csv': 'application/vnd.google-apps.spreadsheet',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'application/vnd.google-apps.spreadsheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'application/vnd.google-apps.presentation',
};

// ---------- MIME email ----------
const enc = s => /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;
const wrap76 = b => b.replace(/.{1,76}/g, '$&\r\n');
const addrList = v => (Array.isArray(v) ? v : String(v || '').split(/[,;]/)).map(x => String(x).trim()).filter(Boolean);
function fileNameParam(n) {
  n = String(n || 'lampiran');
  return /^[\x20-\x7e]*$/.test(n) && !/["\\]/.test(n) ? `filename="${n}"` : `filename*=UTF-8''${encodeURIComponent(n)}`;
}
function buildMime({ from, to, cc, bcc, subject, body, htmlBody, attachments }) {
  const b1 = 'mix' + crypto.randomBytes(10).toString('hex'), b2 = 'alt' + crypto.randomBytes(10).toString('hex');
  const H = [];
  if (from) H.push(`From: ${from}`);
  H.push(`To: ${addrList(to).join(', ')}`);
  if (addrList(cc).length) H.push(`Cc: ${addrList(cc).join(', ')}`);
  if (addrList(bcc).length) H.push(`Bcc: ${addrList(bcc).join(', ')}`);
  H.push(`Subject: ${enc(String(subject || ''))}`, 'MIME-Version: 1.0', `Content-Type: multipart/mixed; boundary="${b1}"`);
  const parts = [];
  parts.push(`--${b1}\r\nContent-Type: multipart/alternative; boundary="${b2}"\r\n\r\n` +
    `--${b2}\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap76(Buffer.from(String(body || ''), 'utf8').toString('base64'))}` +
    (htmlBody ? `--${b2}\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap76(Buffer.from(String(htmlBody), 'utf8').toString('base64'))}` : '') +
    `--${b2}--\r\n`);
  for (const a of attachments || []) {
    const data = typeof a.content === 'string' ? a.content.replace(/\s+/g, '') : Buffer.from(a.content).toString('base64');
    parts.push(`--${b1}\r\nContent-Type: ${a.mimeType || 'application/octet-stream'}; name="${enc(String(a.filename || 'lampiran'))}"\r\nContent-Disposition: attachment; ${fileNameParam(a.filename)}\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap76(data)}`);
  }
  return Buffer.from(H.join('\r\n') + '\r\n\r\n' + parts.join('') + `--${b1}--\r\n`, 'utf8');
}

// ---------- isi berkas Drive dari masukan halaman ----------
function contentOf(input) {
  if (input.textContent != null) return Buffer.from(String(input.textContent), 'utf8');
  const b = input.base64Content ?? input.content;
  if (b == null) return null;
  if (typeof b === 'string') return Buffer.from(b, 'base64');
  if (b.$file) return Buffer.from(b.$file.data);
  return null;
}
const fileView = f => ({ id: f.id, title: f.name, mimeType: f.mimeType, viewUrl: f.webViewLink || (f.mimeType === 'application/vnd.google-apps.folder' ? `https://drive.google.com/drive/folders/${f.id}` : `https://drive.google.com/file/d/${f.id}/view`) });

// masukan bergaya konektor Calendar -> sumber daya Event Calendar API v3
const send = i => i.notificationLevel === 'NONE' ? 'none' : i.notificationLevel === 'EXTERNAL_ONLY' ? 'externalOnly' : (i.notificationLevel ? 'all' : 'none');
function calBody(i) {
  const ev = {};
  if (i.summary != null) ev.summary = i.summary;
  if (i.location != null) ev.location = i.location;
  if (i.description != null) ev.description = i.description;
  if (i.startTime) ev.start = { dateTime: i.startTime, timeZone: i.timeZone || 'Asia/Jakarta' };
  if (i.endTime) ev.end = { dateTime: i.endTime, timeZone: i.timeZone || 'Asia/Jakarta' };
  if (i.attendees) ev.attendees = i.attendees.map(a => ({ email: a.email, ...(a.displayName ? { displayName: a.displayName } : {}) }));
  if (i.overrideReminders || i.useDefaultReminders != null) ev.reminders = { useDefault: !!i.useDefaultReminders && !i.overrideReminders?.length, ...(i.overrideReminders?.length ? { overrides: i.overrideReminders } : {}) };
  return ev;
}
function makeTools(google) {
  const mailUrl = frag => `https://mail.google.com/mail/?authuser=${encodeURIComponent(google.email || '')}#${frag}`;
  const T = {
    'Gmail': {
      async send_message(i) { const r = await google.gmailSend(buildMime(i)); return { id: r.id, threadId: r.threadId, viewUrl: mailUrl('sent/' + (r.threadId || r.id)) }; },
      async create_draft(i) { const r = await google.gmailDraft(buildMime(i)); return { id: r.id, messageId: r.message?.id, viewUrl: mailUrl('drafts?compose=' + (r.message?.id || '')) }; },
    },
    'Google Calendar': {
      async create_event(i) {
        const r = await google.calInsert(calBody(i), send(i));
        return { id: r.id, eventId: r.id, htmlLink: r.htmlLink, viewUrl: r.htmlLink };
      },
      async update_event(i) {
        const ev = calBody(i);
        if (i.addedAttendees?.length || i.removedAttendeeEmails?.length) {
          const cur = await google.calGet(i.eventId), rm = new Set((i.removedAttendeeEmails || []).map(x => x.toLowerCase()));
          const list = (cur.attendees || []).filter(a => !rm.has(String(a.email).toLowerCase()));
          for (const a of i.addedAttendees || []) if (!list.some(x => String(x.email).toLowerCase() === a.email.toLowerCase())) list.push({ email: a.email });
          ev.attendees = list;
        }
        const r = await google.calPatch(i.eventId, ev, send(i));
        return { id: r.id, eventId: r.id, htmlLink: r.htmlLink, viewUrl: r.htmlLink };
      },
      async delete_event(i) { await google.calDelete(i.eventId, send(i)); return { id: i.eventId, deleted: true }; },
    },
    'Google Drive': {
      async create_file(i) {
        const isFolder = i.contentMimeType === 'application/vnd.google-apps.folder' || i.mimeType === 'application/vnd.google-apps.folder';
        const meta = { name: i.title || 'Tanpa judul', ...(i.parentId ? { parents: [i.parentId] } : {}) };
        if (isFolder) { meta.mimeType = 'application/vnd.google-apps.folder'; return fileView(await google.driveCreate(meta)); }
        const data = contentOf(i), src = i.contentMimeType || 'application/octet-stream';
        const target = !i.disableConversionToGoogleType && GOOGLE_TYPE[src];
        if (target) meta.mimeType = target; else if (data) meta.mimeType = src;
        if (data && src === 'text/html' && target) return fileView(await google.driveCreate(meta, data, 'text/html; charset=UTF-8'));
        return fileView(await google.driveCreate(meta, data, src));
      },
      async trash_file(i) { await google.drivePatch(i.fileId, { trashed: true }); return { id: i.fileId, trashed: true }; },
      async update_file(i) {
        const meta = {}; let qs = '';
        if (i.title) meta.name = i.title;
        if (i.description != null) meta.description = i.description;
        if (i.parentId) { const f = await google.driveGet(i.fileId, 'parents'); qs = `&addParents=${encodeURIComponent(i.parentId)}${f.parents?.length ? '&removeParents=' + encodeURIComponent(f.parents.join(',')) : ''}`; }
        return fileView(await google.drivePatch(i.fileId, meta, qs));
      },
      async get_file_metadata(i) {
        const f = await google.driveGet(i.fileId);
        return { ...fileView(f), owner: f.owners?.[0]?.emailAddress || '', canAddChildren: f.capabilities?.canAddChildren !== false, trashed: !!f.trashed, parentId: f.parents?.[0] };
      },
    },
  };
  return async function callTool(server, tool, input) {
    const fn = T[server]?.[tool];
    if (!fn) throw new GError('not_in_manifest', `Alat ${server}/${tool} tidak tersedia di aplikasi desktop.`);
    return { payload: await fn(input || {}) };
  };
}
module.exports = { makeTools, buildMime };
