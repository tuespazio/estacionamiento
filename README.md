# Estacionamiento vecinal

Aplicación web sencilla para administrar el control de un estacionamiento de vecinos. Permite:

- Dar de alta y baja vecinos con su información básica.
- Administrar los vehículos registrados para cada vecino.
- Registrar pagos en efectivo o depósito, incluyendo comprobantes.
- Brindar un portal para que los vecinos consulten su información.

## Requisitos

- Python 3.10+
- Dependencias listadas en `requirements.txt`

Instala las dependencias con:

```bash
pip install -r requirements.txt
```

## Uso

Inicializa la base de datos (sólo la primera vez):

```bash
flask --app app init-db
```

Arranca la aplicación en modo desarrollo:

```bash
flask --app app run --debug
```

La aplicación estará disponible en `http://127.0.0.1:5000`.

- Panel administrativo: `http://127.0.0.1:5000/admin/users`
- Portal de vecinos: `http://127.0.0.1:5000/portal`

Los comprobantes de depósitos se almacenan en la carpeta `static/uploads`.
