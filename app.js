const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const session = require('express-session');
const flash = require('connect-flash');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_DIR = __dirname;
const UPLOAD_DIR = path.join(BASE_DIR, 'static', 'uploads');
const ALLOWED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.pdf']);

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new Database(path.join(BASE_DIR, 'parking.db'));
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS neighbors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    address TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS vehicles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    neighbor_id INTEGER NOT NULL REFERENCES neighbors(id) ON DELETE CASCADE,
    license_plate TEXT NOT NULL,
    make TEXT NOT NULL,
    model TEXT NOT NULL,
    control_number TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    neighbor_id INTEGER NOT NULL REFERENCES neighbors(id) ON DELETE CASCADE,
    method TEXT NOT NULL,
    amount REAL NOT NULL,
    deposit_account TEXT,
    screenshot_path TEXT,
    created_at TEXT NOT NULL
  );
`);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '');
    const uniqueSuffix = Math.random().toString(36).slice(2, 8);
    cb(null, `${timestamp}_${uniqueSuffix}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ext || !ALLOWED_EXTENSIONS.has(ext)) {
      return cb(new Error('Formato de archivo no permitido. Usa png, jpg, jpeg, gif o pdf.'));
    }
    cb(null, true);
  },
});

app.set('view engine', 'ejs');
app.set('views', path.join(BASE_DIR, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(BASE_DIR, 'static')));
app.use('/uploads', express.static(UPLOAD_DIR));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev-session-secret',
    resave: false,
    saveUninitialized: false,
  })
);
app.use(flash());
app.use((req, res, next) => {
  res.locals.successMessages = req.flash('success');
  res.locals.errorMessages = req.flash('error');
  res.locals.infoMessages = req.flash('info');
  next();
});

function nowIso() {
  return new Date().toISOString();
}

function formatDateTime(value, options = { dateStyle: 'short', timeStyle: 'short' }) {
  try {
    return new Intl.DateTimeFormat('es-MX', options).format(new Date(value));
  } catch (_err) {
    return value;
  }
}

const queries = {
  listNeighborsWithStats: db.prepare(`
    SELECT
      n.id,
      n.first_name,
      n.last_name,
      n.address,
      n.created_at,
      IFNULL((SELECT COUNT(*) FROM vehicles v WHERE v.neighbor_id = n.id), 0) AS vehicle_count,
      IFNULL((SELECT COUNT(*) FROM payments p WHERE p.neighbor_id = n.id), 0) AS payment_count
    FROM neighbors n
    ORDER BY n.created_at DESC
  `),
  listNeighbors: db.prepare('SELECT id, first_name, last_name, address FROM neighbors ORDER BY last_name, first_name'),
  insertNeighbor: db.prepare('INSERT INTO neighbors (first_name, last_name, address, created_at) VALUES (?, ?, ?, ?)'),
  deleteNeighbor: db.prepare('DELETE FROM neighbors WHERE id = ?'),
  findNeighbor: db.prepare('SELECT id, first_name, last_name, address, created_at FROM neighbors WHERE id = ?'),
  listVehiclesForNeighbor: db.prepare('SELECT id, license_plate, make, model, control_number FROM vehicles WHERE neighbor_id = ? ORDER BY created_at DESC'),
  insertVehicle: db.prepare('INSERT INTO vehicles (neighbor_id, license_plate, make, model, control_number, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
  deleteVehicle: db.prepare('DELETE FROM vehicles WHERE id = ? AND neighbor_id = ?'),
  listPaymentsForNeighbor: db.prepare('SELECT id, method, amount, deposit_account, screenshot_path, created_at FROM payments WHERE neighbor_id = ? ORDER BY created_at DESC'),
  insertPayment: db.prepare('INSERT INTO payments (neighbor_id, method, amount, deposit_account, screenshot_path, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
  deletePayment: db.prepare('DELETE FROM payments WHERE id = ? AND neighbor_id = ?'),
  getPayment: db.prepare('SELECT id, neighbor_id, screenshot_path FROM payments WHERE id = ? AND neighbor_id = ?'),
  listPaymentFilesForNeighbor: db.prepare('SELECT screenshot_path FROM payments WHERE neighbor_id = ? AND screenshot_path IS NOT NULL'),
  searchNeighbors: db.prepare(`
    SELECT
      n.id,
      n.first_name,
      n.last_name,
      n.address,
      IFNULL((SELECT COUNT(*) FROM vehicles v WHERE v.neighbor_id = n.id), 0) AS vehicle_count
    FROM neighbors n
    WHERE n.first_name LIKE ? OR n.last_name LIKE ? OR n.address LIKE ?
    ORDER BY n.last_name, n.first_name
  `),
};

app.get('/', (_req, res) => {
  const neighbors = queries.listNeighborsWithStats.all();
  res.render('index', {
    title: 'Panel principal',
    neighbors,
  });
});

app
  .route('/admin/users')
  .get((_req, res) => {
    const neighbors = queries.listNeighbors.all();
    res.render('admin/users', {
      title: 'Administración de vecinos',
      neighbors,
    });
  })
  .post((req, res) => {
    const firstName = req.body.first_name ? req.body.first_name.trim() : '';
    const lastName = req.body.last_name ? req.body.last_name.trim() : '';
    const address = req.body.address ? req.body.address.trim() : '';

    if (!firstName || !lastName || !address) {
      req.flash('error', 'Todos los campos son obligatorios.');
      return res.redirect('/admin/users');
    }

    queries.insertNeighbor.run(firstName, lastName, address, nowIso());
    req.flash('success', 'Vecino registrado correctamente.');
    res.redirect('/admin/users');
  });

app.post('/admin/users/:neighborId/delete', (req, res) => {
  const neighborId = Number(req.params.neighborId);
  const neighbor = queries.findNeighbor.get(neighborId);
  if (!neighbor) {
    req.flash('error', 'El vecino no existe.');
    return res.redirect('/admin/users');
  }

  const paymentFiles = queries.listPaymentFilesForNeighbor.all(neighborId);
  paymentFiles.forEach(({ screenshot_path: file }) => {
    if (!file) return;
    const filePath = path.join(UPLOAD_DIR, file);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  });

  queries.deleteNeighbor.run(neighborId);
  req.flash('success', 'Vecino eliminado.');
  res.redirect('/admin/users');
});

app
  .route('/admin/users/:neighborId/vehicles')
  .get((req, res) => {
    const neighborId = Number(req.params.neighborId);
    const neighbor = queries.findNeighbor.get(neighborId);
    if (!neighbor) {
      req.flash('error', 'El vecino no existe.');
      return res.redirect('/admin/users');
    }
    const vehicles = queries.listVehiclesForNeighbor.all(neighborId);
    res.render('admin/vehicles', {
      title: `Vehículos de ${neighbor.first_name} ${neighbor.last_name}`,
      neighbor,
      vehicles,
    });
  })
  .post((req, res) => {
    const neighborId = Number(req.params.neighborId);
    const neighbor = queries.findNeighbor.get(neighborId);
    if (!neighbor) {
      req.flash('error', 'El vecino no existe.');
      return res.redirect('/admin/users');
    }

    const licensePlate = req.body.license_plate ? req.body.license_plate.trim() : '';
    const make = req.body.make ? req.body.make.trim() : '';
    const model = req.body.model ? req.body.model.trim() : '';
    const controlNumber = req.body.control_number ? req.body.control_number.trim() : '';

    if (!licensePlate || !make || !model || !controlNumber) {
      req.flash('error', 'Todos los campos son obligatorios.');
      return res.redirect(`/admin/users/${neighborId}/vehicles`);
    }

    queries.insertVehicle.run(neighborId, licensePlate, make, model, controlNumber, nowIso());
    req.flash('success', 'Vehículo agregado.');
    res.redirect(`/admin/users/${neighborId}/vehicles`);
  });

app.post('/admin/users/:neighborId/vehicles/:vehicleId/delete', (req, res) => {
  const neighborId = Number(req.params.neighborId);
  const vehicleId = Number(req.params.vehicleId);
  const neighbor = queries.findNeighbor.get(neighborId);
  if (!neighbor) {
    req.flash('error', 'El vecino no existe.');
    return res.redirect('/admin/users');
  }

  queries.deleteVehicle.run(vehicleId, neighborId);
  req.flash('success', 'Vehículo eliminado.');
  res.redirect(`/admin/users/${neighborId}/vehicles`);
});

const paymentUploadMiddleware = upload.single('screenshot');

app
  .route('/admin/users/:neighborId/payments')
  .get((req, res) => {
    const neighborId = Number(req.params.neighborId);
    const neighbor = queries.findNeighbor.get(neighborId);
    if (!neighbor) {
      req.flash('error', 'El vecino no existe.');
      return res.redirect('/admin/users');
    }

    const payments = queries.listPaymentsForNeighbor.all(neighborId).map((payment) => ({
      ...payment,
      formattedDate: formatDateTime(payment.created_at),
      formattedDateShort: formatDateTime(payment.created_at, { dateStyle: 'short' }),
      formattedAmount: new Intl.NumberFormat('es-MX', {
        style: 'currency',
        currency: 'MXN',
        minimumFractionDigits: 2,
      }).format(payment.amount || 0),
    }));

    res.render('admin/payments', {
      title: `Pagos de ${neighbor.first_name} ${neighbor.last_name}`,
      neighbor,
      payments,
    });
  })
  .post((req, res) => {
    const neighborId = Number(req.params.neighborId);
    const neighbor = queries.findNeighbor.get(neighborId);
    if (!neighbor) {
      req.flash('error', 'El vecino no existe.');
      return res.redirect('/admin/users');
    }

    paymentUploadMiddleware(req, res, (err) => {
      if (err) {
        req.flash('error', err.message);
        return res.redirect(`/admin/users/${neighborId}/payments`);
      }

      const method = req.body.method ? req.body.method.trim() : '';
      const amountRaw = req.body.amount ? req.body.amount.trim() : '';
      const depositAccount = req.body.deposit_account ? req.body.deposit_account.trim() : null;
      const amount = Number(amountRaw);

      if (!method || Number.isNaN(amount)) {
        if (req.file) {
          fs.unlink(req.file.path, () => {});
        }
        req.flash('error', 'Debe capturar el método de pago y un monto válido.');
        return res.redirect(`/admin/users/${neighborId}/payments`);
      }

      const screenshotPath = req.file ? path.basename(req.file.path) : null;

      queries.insertPayment.run(neighborId, method, amount, depositAccount, screenshotPath, nowIso());
      req.flash('success', 'Pago registrado.');
      res.redirect(`/admin/users/${neighborId}/payments`);
    });
  });

app.post('/admin/users/:neighborId/payments/:paymentId/delete', (req, res) => {
  const neighborId = Number(req.params.neighborId);
  const paymentId = Number(req.params.paymentId);
  const neighbor = queries.findNeighbor.get(neighborId);
  if (!neighbor) {
    req.flash('error', 'El vecino no existe.');
    return res.redirect('/admin/users');
  }

  const payment = queries.getPayment.get(paymentId, neighborId);
  if (payment && payment.screenshot_path) {
    const filePath = path.join(UPLOAD_DIR, payment.screenshot_path);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  queries.deletePayment.run(paymentId, neighborId);
  req.flash('success', 'Pago eliminado.');
  res.redirect(`/admin/users/${neighborId}/payments`);
});

app
  .route('/portal')
  .get((_req, res) => {
    res.render('portal/search', {
      title: 'Portal de vecinos',
      neighbors: [],
      query: '',
    });
  })
  .post((req, res) => {
    const query = req.body.query ? req.body.query.trim() : '';
    const likeQuery = `%${query}%`;
    const neighbors = query
      ? queries.searchNeighbors.all(likeQuery, likeQuery, likeQuery)
      : [];

    res.render('portal/search', {
      title: 'Portal de vecinos',
      neighbors,
      query,
    });
  });

app.get('/portal/:neighborId', (req, res) => {
  const neighborId = Number(req.params.neighborId);
  const neighbor = queries.findNeighbor.get(neighborId);
  if (!neighbor) {
    req.flash('error', 'El vecino no existe.');
    return res.redirect('/portal');
  }

  const vehicles = queries.listVehiclesForNeighbor.all(neighborId);
  const payments = queries.listPaymentsForNeighbor.all(neighborId).map((payment) => ({
    ...payment,
    formattedDate: formatDateTime(payment.created_at, { dateStyle: 'short' }),
    formattedAmount: new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency: 'MXN',
      minimumFractionDigits: 2,
    }).format(payment.amount || 0),
  }));

  res.render('portal/detail', {
    title: `Resumen de ${neighbor.first_name} ${neighbor.last_name}`,
    neighbor,
    vehicles,
    payments,
  });
});

app.use((req, res) => {
  res.status(404).render('404', { title: 'Página no encontrada' });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).render('500', { title: 'Error del servidor' });
});

app.listen(PORT, () => {
  console.log(`Aplicación escuchando en http://localhost:${PORT}`);
});
