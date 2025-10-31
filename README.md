# Sistema de control de estacionamiento vecinal

Aplicación web construida con Node.js y Express para administrar vecinos, vehículos y pagos de un estacionamiento comunitario. Incluye un panel administrativo para el registro de información y un portal público para que cada vecino consulte su estado.

## Requisitos

- Node.js 18 o superior
- npm 9 o superior

## Configuración inicial

1. Instala las dependencias del proyecto:
   ```bash
   npm install
   ```
2. Crea la estructura de directorios para archivos cargados (se genera automáticamente al iniciar, pero puedes crearla manualmente si lo prefieres):
   ```bash
   mkdir -p static/uploads
   ```
3. Opcional: define una variable de entorno `SESSION_SECRET` para asegurar las sesiones.

## Ejecución

Inicia el servidor en modo desarrollo:

```bash
npm start
```

La aplicación quedará disponible en `http://localhost:3000`.

Al ejecutarse por primera vez se crea automáticamente la base de datos SQLite `parking.db` con las tablas necesarias.

## Estructura principal

- `app.js`: servidor Express, rutas y lógica de negocio.
- `views/`: plantillas EJS para el panel administrativo y el portal de vecinos.
- `static/`: estilos compartidos y archivos subidos (en `static/uploads`).
- `parking.db`: base de datos SQLite generada automáticamente.

## Funcionalidades clave

- Alta, consulta y baja de vecinos con nombre, apellido y domicilio.
- Administración de vehículos asociados a cada vecino (placas, marca, modelo y número de control).
- Registro de pagos en efectivo o depósito con posibilidad de adjuntar comprobantes.
- Portal para que los vecinos consulten sus vehículos registrados y el historial de pagos.

## Notas

- Los archivos adjuntos de comprobantes se almacenan en `static/uploads/` y se eliminan al borrar el pago correspondiente o el vecino asociado.
- Las relaciones entre vecinos, vehículos y pagos están protegidas con llaves foráneas para mantener la integridad de la información.
