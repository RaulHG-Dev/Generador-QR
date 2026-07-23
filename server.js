const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const QRCode = require('qrcode');
const initSqlJs = require('sql.js');

const app = express();
const port = process.env.PORT || 3000;
const rootDir = __dirname;
const dataDir = path.join(rootDir, 'data');
const uploadsDir = path.join(rootDir, 'uploads');
const publicDir = path.join(rootDir, 'public');
const dbFile = path.join(dataDir, 'qr.sqlite');
const sqlJsWasmPath = path.join(rootDir, 'node_modules', 'sql.js', 'dist');

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(uploadsDir, { recursive: true });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(uploadsDir));
app.use(express.static(publicDir));

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, uploadsDir),
  filename: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase() || '.png';
    callback(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${extension}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    if (file.mimetype.startsWith('image/')) {
      callback(null, true);
      return;
    }

    callback(new Error('Solo se permiten archivos de imagen para el icono.'));
  }
});

let SQL;
let database;

function ensureHexColor(color) {
  const value = String(color || '').trim();
  if (!/^#([0-9a-fA-F]{6})$/.test(value)) {
    throw new Error('El color debe ser hexadecimal de 6 dígitos, por ejemplo #0F4C81.');
  }

  return value.toUpperCase();
}

function ensureTitle(title) {
  const value = String(title || '').trim();
  if (!value) {
    throw new Error('El título es obligatorio.');
  }

  return value;
}

function safeUrl(rawUrl) {
  const value = String(rawUrl || '').trim();
  const parsed = new URL(value);
  return parsed.toString();
}

function iconToDataUrl(iconPath) {
  if (!iconPath || !fs.existsSync(iconPath)) {
    return null;
  }

  const extension = path.extname(iconPath).toLowerCase();
  const mimeByExtension = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml'
  };
  const mime = mimeByExtension[extension] || 'application/octet-stream';
  const base64 = fs.readFileSync(iconPath).toString('base64');
  return `data:${mime};base64,${base64}`;
}

function parseSvgViewBox(svg) {
  const match = svg.match(/viewBox="([^"]+)"/i);
  if (!match) {
    return { width: 29, height: 29 };
  }

  const parts = match[1].trim().split(/\s+/).map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN)) {
    return { width: 29, height: 29 };
  }

  return { width: parts[2], height: parts[3] };
}

function normalizeFileName(value) {
  return String(value || 'qr')
    .trim()
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'qr';
}

async function buildQrSvg({ url, color, iconPath }) {
  const qrSvg = await QRCode.toString(url, {
    type: 'svg',
    margin: 4,
    errorCorrectionLevel: 'H',
    color: {
      dark: color,
      light: '#FFFFFF'
    }
  });

  if (!iconPath) {
    return qrSvg;
  }

  const iconDataUrl = iconToDataUrl(iconPath);
  if (!iconDataUrl) {
    return qrSvg;
  }

  const { width, height } = parseSvgViewBox(qrSvg);
  const minDimension = Math.min(width, height);
  const logoBoxSize = minDimension * 0.26;
  const logoSize = logoBoxSize * 0.68;
  const centerX = width / 2;
  const centerY = height / 2;
  const logoX = centerX - logoSize / 2;
  const logoY = centerY - logoSize / 2;
  const boxX = centerX - logoBoxSize / 2;
  const boxY = centerY - logoBoxSize / 2;
  const overlay = `
    <rect x="${boxX}" y="${boxY}" width="${logoBoxSize}" height="${logoBoxSize}" rx="24" ry="24" fill="#ffffff"/>
    <image href="${iconDataUrl}" x="${logoX}" y="${logoY}" width="${logoSize}" height="${logoSize}" preserveAspectRatio="xMidYMid meet"/>
  `;

  return qrSvg.replace('</svg>', `<g>${overlay}</g></svg>`);
}

function saveDatabase() {
  fs.writeFileSync(dbFile, Buffer.from(database.export()));
}

function getStoredIconPath(iconPath) {
  return iconPath ? path.join(uploadsDir, path.basename(iconPath)) : null;
}

function removeIconFile(iconPath) {
  const storedIconPath = getStoredIconPath(iconPath);
  if (storedIconPath && fs.existsSync(storedIconPath)) {
    fs.unlinkSync(storedIconPath);
  }
}

async function initDatabase() {
  SQL = await initSqlJs({
    locateFile: (fileName) => path.join(sqlJsWasmPath, fileName)
  });

  if (fs.existsSync(dbFile)) {
    const fileBuffer = fs.readFileSync(dbFile);
    database = new SQL.Database(fileBuffer);
  } else {
    database = new SQL.Database();
  }

  database.run(`
    CREATE TABLE IF NOT EXISTS qr_records (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      source_url TEXT NOT NULL,
      color_hex TEXT NOT NULL,
      icon_path TEXT,
      created_at TEXT NOT NULL
    )
  `);

  const columns = database.exec(`PRAGMA table_info(qr_records)`);
  const hasTitleColumn = columns.length > 0 && columns[0].values.some((column) => column[1] === 'title');
  if (!hasTitleColumn) {
    database.run(`ALTER TABLE qr_records ADD COLUMN title TEXT NOT NULL DEFAULT ''`);
    database.run(`UPDATE qr_records SET title = source_url WHERE title = '' OR title IS NULL`);
  }

  saveDatabase();
}

function insertRecord({ id, title, sourceUrl, colorHex, iconPath, createdAt }) {
  const statement = database.prepare(`
    INSERT INTO qr_records (id, title, source_url, color_hex, icon_path, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  statement.run([id, title, sourceUrl, colorHex, iconPath, createdAt]);
  statement.free();
  saveDatabase();
}

function updateRecord({ id, title, sourceUrl, colorHex, iconPath }) {
  const statement = database.prepare(`
    UPDATE qr_records
    SET title = ?, source_url = ?, color_hex = ?, icon_path = ?
    WHERE id = ?
  `);

  statement.run([title, sourceUrl, colorHex, iconPath, id]);
  statement.free();
  saveDatabase();
}

function deleteRecord(id) {
  const statement = database.prepare(`
    DELETE FROM qr_records
    WHERE id = ?
  `);

  statement.run([id]);
  statement.free();
  saveDatabase();
}

function fetchRecords(limit = 20) {
  const statement = database.prepare(`
    SELECT id, title, source_url AS sourceUrl, color_hex AS colorHex, icon_path AS iconPath, created_at AS createdAt
    FROM qr_records
    ORDER BY created_at DESC
    LIMIT ?
  `);

  statement.bind([limit]);
  const records = [];
  while (statement.step()) {
    records.push(statement.getAsObject());
  }
  statement.free();
  return records;
}

function fetchRecordById(id) {
  const statement = database.prepare(`
    SELECT id, title, source_url AS sourceUrl, color_hex AS colorHex, icon_path AS iconPath, created_at AS createdAt
    FROM qr_records
    WHERE id = ?
    LIMIT 1
  `);

  statement.bind([id]);
  const row = statement.step() ? statement.getAsObject() : null;
  statement.free();
  return row;
}

app.get('/api/history', (_req, res) => {
  res.json({ records: fetchRecords() });
});

app.get('/api/qr/:id/download', async (req, res, next) => {
  try {
    const record = fetchRecordById(req.params.id);
    if (!record) {
      res.status(404).json({ error: 'No se encontró el QR solicitado.' });
      return;
    }

    const svg = await buildQrSvg({
      url: record.sourceUrl,
      color: record.colorHex,
      iconPath: getStoredIconPath(record.iconPath)
    });

    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${normalizeFileName(record.title)}.svg"`);
    res.send(svg);
  } catch (error) {
    next(error);
  }
});

app.put('/api/qr/:id', upload.single('icon'), async (req, res, next) => {
  try {
    const record = fetchRecordById(req.params.id);
    if (!record) {
      if (req.file && req.file.path && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }

      res.status(404).json({ error: 'No se encontró el QR solicitado.' });
      return;
    }

    const title = ensureTitle(req.body.title);
    const sourceUrl = safeUrl(req.body.url);
    const colorHex = ensureHexColor(req.body.color);
    const iconPath = req.file ? path.basename(req.file.path) : record.iconPath;

    if (req.file && record.iconPath && record.iconPath !== iconPath) {
      removeIconFile(record.iconPath);
    }

    updateRecord({
      id: record.id,
      title,
      sourceUrl,
      colorHex,
      iconPath
    });

    const svg = await buildQrSvg({
      url: sourceUrl,
      color: colorHex,
      iconPath: getStoredIconPath(iconPath)
    });

    res.json({
      record: {
        id: record.id,
        title,
        sourceUrl,
        colorHex,
        iconPath: iconPath ? `/uploads/${path.basename(iconPath)}` : null,
        createdAt: record.createdAt
      },
      svg
    });
  } catch (error) {
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.status(400);
    next(error);
  }
});

app.delete('/api/qr/:id', (req, res, next) => {
  try {
    const record = fetchRecordById(req.params.id);
    if (!record) {
      res.status(404).json({ error: 'No se encontró el QR solicitado.' });
      return;
    }

    deleteRecord(record.id);
    removeIconFile(record.iconPath);

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post('/api/qr', upload.single('icon'), async (req, res, next) => {
  try {
    const title = ensureTitle(req.body.title);
    const sourceUrl = safeUrl(req.body.url);
    const colorHex = ensureHexColor(req.body.color);
    const iconPath = req.file ? req.file.path : null;
    const createdAt = new Date().toISOString();
    const id = crypto.randomUUID();

    insertRecord({
      id,
      title,
      sourceUrl,
      colorHex,
      iconPath: iconPath ? path.basename(iconPath) : null,
      createdAt
    });

    const svg = await buildQrSvg({
      url: sourceUrl,
      color: colorHex,
      iconPath
    });

    res.json({
      record: {
        id,
        title,
        sourceUrl,
        colorHex,
        iconPath: iconPath ? `/uploads/${path.basename(iconPath)}` : null,
        createdAt
      },
      svg
    });
  } catch (error) {
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.status(400);
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  const status = res.statusCode >= 400 ? res.statusCode : 500;
  res.status(status).json({
    error: error.message || 'Error inesperado del servidor.'
  });
});

async function start() {
  await initDatabase();
  app.listen(port, () => {
    console.log(`Generador QR ejecutándose en http://localhost:${port}`);
  });
}

start().catch((error) => {
  console.error('No se pudo iniciar la aplicación:', error);
  process.exit(1);
});
