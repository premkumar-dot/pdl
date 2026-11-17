require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const Database = require('better-sqlite3');
const multer = require('multer');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const PRIVATE_UPLOADS = path.join(DATA_DIR, 'private-uploads');
app.set('trust proxy', 1);
fs.mkdirSync(PRIVATE_UPLOADS, { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });

if (!process.env.SESSION_SECRET || !process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD) {
  console.error('Set SESSION_SECRET, ADMIN_USERNAME and ADMIN_PASSWORD in .env before starting PDL.');
  process.exit(1);
}
if (process.env.ADMIN_PASSWORD.length < 14) {
  console.error('ADMIN_PASSWORD must be at least 14 characters.');
  process.exit(1);
}

const db = new Database(path.join(DATA_DIR, 'pdl.sqlite'));
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK(type IN ('enquiry','career','partner')),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  company TEXT,
  payload TEXT NOT NULL,
  file_name TEXT,
  stored_file TEXT,
  status TEXT NOT NULL DEFAULT 'New',
  internal_notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_submissions_type ON submissions(type);
CREATE INDEX IF NOT EXISTS idx_submissions_created ON submissions(created_at);
`);

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, PRIVATE_UPLOADS),
    filename: (_req, file, cb) => cb(null, crypto.randomUUID() + path.extname(file.originalname).toLowerCase())
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowed = ['.pdf','.doc','.docx','.jpg','.jpeg','.png'];
    if (!allowed.includes(ext)) return cb(new Error('Unsupported attachment type.'));
    cb(null, true);
  }
});

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use(session({
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: DATA_DIR }),
  name: 'pdl.sid',
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', maxAge: 8 * 60 * 60 * 1000 }
}));

const publicLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 12, standardHeaders: true, legacyHeaders: false });
const insert = db.prepare(`INSERT INTO submissions (type,name,email,phone,company,payload,file_name,stored_file)
VALUES (@type,@name,@email,@phone,@company,@payload,@file_name,@stored_file)`);
const NOTIFY_EMAIL = clean(process.env.NOTIFY_EMAIL || 'info@pdl-logistics.com.sg', 160).toLowerCase();
const mailHost = clean(process.env.SMTP_HOST, 200);
const mailPort = Number(process.env.SMTP_PORT || 587);
const mailUser = clean(process.env.SMTP_USER, 200);
const mailPass = String(process.env.SMTP_PASS || '');
const mailSecure = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true';
const mailFrom = clean(process.env.MAIL_FROM || mailUser || NOTIFY_EMAIL, 200);
const mailer = mailHost
  ? nodemailer.createTransport({
      host: mailHost,
      port: mailPort,
      secure: mailSecure,
      auth: mailUser && mailPass ? { user: mailUser, pass: mailPass } : undefined
    })
  : null;

function clean(v, max=2500) { return String(v || '').trim().slice(0,max); }
function validEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }
function required(body, fields) {
  for (const f of fields) if (!clean(body[f], 300)) return `${f} is required.`;
  return null;
}
function storeSubmission(type, req, file, name, email, phone, company) {
  const payload = { ...req.body };
  delete payload.password;
  return insert.run({
    type, name: clean(name,120), email: clean(email,160).toLowerCase(),
    phone: clean(phone,40), company: clean(company,160),
    payload: JSON.stringify(payload), file_name: file ? clean(file.originalname,200) : null,
    stored_file: file ? file.filename : null
  });
}
function auth(req,res,next) {
  if (!req.session.admin) return res.status(401).json({error:'Please sign in again.'});
  next();
}
function humanType(type) {
  return ({ enquiry: 'Enquiry', career: 'Career Application', partner: 'Transport Partner Registration' }[type] || 'Submission');
}
async function notifySubmission(type, req, file, id) {
  if (!mailer || !NOTIFY_EMAIL) return;
  const fields = Object.entries(req.body || {})
    .filter(([k]) => k !== 'consent' && k !== 'password')
    .map(([k,v]) => `${k}: ${clean(v, 1000)}`)
    .join('\n');
  const subject = `[PDL Website] ${humanType(type)} #${id}`;
  const text = [
    `Type: ${humanType(type)}`,
    `Submission ID: ${id}`,
    `Submitted At: ${new Date().toISOString()}`,
    `IP Address: ${clean(req.ip, 120)}`,
    file ? `Attachment: ${clean(file.originalname, 200)}` : 'Attachment: none',
    '',
    'Form details:',
    fields || '(no fields)'
  ].join('\n');
  try {
    await mailer.sendMail({ from: mailFrom, to: NOTIFY_EMAIL, subject, text });
  } catch (err) {
    console.error('Unable to send submission email notification:', err.message || err);
  }
}
function sameOrigin(req,res,next) {
  const origin = req.get('origin');
  if (origin) {
    const host = req.get('host');
    try { if (new URL(origin).host !== host) return res.status(403).json({error:'Request origin not allowed.'}); }
    catch { return res.status(403).json({error:'Invalid request origin.'}); }
  }
  next();
}

app.post('/api/enquiries', publicLimiter, upload.none(), sameOrigin, (req,res) => {
  const err = required(req.body,['customerType','name','email','phone','service','consent']);
  if (err) return res.status(400).json({error:err});
  if (!validEmail(req.body.email)) return res.status(400).json({error:'Please enter a valid email address.'});
  const result = storeSubmission('enquiry',req,null,req.body.name,req.body.email,req.body.phone,req.body.company);
  notifySubmission('enquiry', req, null, result.lastInsertRowid);
  res.status(201).json({message:'Thank you. Your enquiry has been received. The PDL team can now review it.',id:result.lastInsertRowid});
});
app.post('/api/careers', publicLimiter, upload.single('cv'), sameOrigin, (req,res) => {
  const err = required(req.body,['name','email','phone','role','consent']);
  if (err) { if(req.file) fs.unlinkSync(req.file.path); return res.status(400).json({error:err}); }
  if (!validEmail(req.body.email)) { if(req.file) fs.unlinkSync(req.file.path); return res.status(400).json({error:'Please enter a valid email address.'}); }
  const result = storeSubmission('career',req,req.file,req.body.name,req.body.email,req.body.phone,'');
  notifySubmission('career', req, req.file, result.lastInsertRowid);
  res.status(201).json({message:'Thank you. Your career application has been received.',id:result.lastInsertRowid});
});
app.post('/api/partners', publicLimiter, upload.single('document'), sameOrigin, (req,res) => {
  const err = required(req.body,['partnerType','contactName','phone','email','vehicleType','consent']);
  if (err) { if(req.file) fs.unlinkSync(req.file.path); return res.status(400).json({error:err}); }
  if (!validEmail(req.body.email)) { if(req.file) fs.unlinkSync(req.file.path); return res.status(400).json({error:'Please enter a valid email address.'}); }
  const result = storeSubmission('partner',req,req.file,req.body.contactName,req.body.email,req.body.phone,req.body.company);
  notifySubmission('partner', req, req.file, result.lastInsertRowid);
  res.status(201).json({message:'Thank you. Your transport partner registration has been received.',id:result.lastInsertRowid});
});

app.post('/api/admin/login', publicLimiter, sameOrigin, async (req,res) => {
  const username = clean(req.body.username,100);
  const password = String(req.body.password || '');
  const expectedUser = process.env.ADMIN_USERNAME;
  const userOk = crypto.timingSafeEqual(Buffer.from(username.padEnd(100,' ').slice(0,100)), Buffer.from(expectedUser.padEnd(100,' ').slice(0,100)));
  const passOk = await bcrypt.compare(password, process.env.ADMIN_PASSWORD_HASH || await bcrypt.hash(process.env.ADMIN_PASSWORD, 12));
  if (!userOk || !passOk) return res.status(401).json({error:'Invalid username or password.'});
  req.session.regenerate(err => {
    if (err) return res.status(500).json({error:'Unable to start session.'});
    req.session.admin = true;
    res.json({ok:true});
  });
});
app.post('/api/admin/logout', auth, sameOrigin, (req,res) => req.session.destroy(() => res.json({ok:true})));
app.get('/api/admin/me', auth, (_req,res) => res.json({ok:true}));
app.get('/api/admin/submissions', auth, (req,res) => {
  const type = clean(req.query.type,20);
  const status = clean(req.query.status,40);
  const search = clean(req.query.search,100);
  let sql = 'SELECT id,type,name,email,phone,company,payload,file_name,status,internal_notes,created_at,updated_at FROM submissions WHERE 1=1';
  const args = {};
  if (['enquiry','career','partner'].includes(type)) { sql += ' AND type=@type'; args.type=type; }
  if (status) { sql += ' AND status=@status'; args.status=status; }
  if (search) { sql += ' AND (name LIKE @search OR email LIKE @search OR company LIKE @search)'; args.search='%'+search+'%'; }
  sql += ' ORDER BY id DESC LIMIT 500';
  const rows = db.prepare(sql).all(args).map(r => ({...r,payload:JSON.parse(r.payload)}));
  res.json(rows);
});
app.patch('/api/admin/submissions/:id', auth, sameOrigin, (req,res) => {
  const id = Number(req.params.id);
  const status = clean(req.body.status,40);
  const notes = clean(req.body.internal_notes,5000);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({error:'Invalid record.'});
  if (!['New','In Review','Contacted','Quoted','Shortlisted','Accepted','Rejected','Closed'].includes(status)) return res.status(400).json({error:'Invalid status.'});
  const result = db.prepare("UPDATE submissions SET status=?, internal_notes=?, updated_at=datetime('now') WHERE id=?").run(status,notes,id);
  if (!result.changes) return res.status(404).json({error:'Record not found.'});
  res.json({ok:true});
});
app.get('/api/admin/files/:id', auth, (req,res) => {
  const row = db.prepare('SELECT file_name,stored_file FROM submissions WHERE id=?').get(Number(req.params.id));
  if (!row || !row.stored_file) return res.status(404).send('File not found.');
  const filePath = path.join(PRIVATE_UPLOADS, path.basename(row.stored_file));
  if (!fs.existsSync(filePath)) return res.status(404).send('File not found.');
  res.download(filePath, row.file_name || 'attachment');
});

app.use(['/data','/server.js','/package.json'], (_req,res) => res.sendStatus(404));
app.use(express.static(ROOT, { index:'index.html', dotfiles:'deny' }));
app.get('/admin', (_req,res) => res.sendFile(path.join(ROOT,'admin.html')));
app.use((err,_req,res,_next) => {
  console.error(err);
  const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Attachment must be 5 MB or smaller.' : (err.message || 'Server error.');
  res.status(400).json({error:msg});
});
app.listen(PORT, () => console.log(`PDL website running at http://localhost:${PORT}`));
