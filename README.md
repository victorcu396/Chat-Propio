# kiVooSpace![alt text](image.png)

Chat en tiempo real entre usuarios, con soporte de imágenes, emojis y notificaciones. Construido sobre WebSockets, Node.js y MongoDB.

---

## Requisitos

- Node.js 18+
- Una base de datos MongoDB (local o Atlas)

---

## Instalación

```bash
git clone https://github.com/tu-usuario/kiVooSpace.git
cd kiVooSpace
npm install
```

Edita la cadena de conexión en `server.js`:

```js
mongoose.connect('mongodb+srv://usuario:contraseña@cluster.mongodb.net/chat')
```

Arranca el servidor:

```bash
node server.js
```

Abre `http://localhost:8080` en el navegador.

---

## Estructura

```
chatterpro/
├── models/
│   └── Message.js       # Esquema de mensajes (Mongoose)
├── public/
│   └── index.html       # Frontend completo
└── server.js            # Servidor WebSocket + API
```

---

## Funcionalidades

**Mensajería**
- Chat privado entre usuarios conectados
- Historial de conversaciones persistido en MongoDB
- Indicadores de entrega (✔) y lectura (✔✔ leído)
- Indicador de "está escribiendo..." en tiempo real

**Multimedia**
- Envío de imágenes desde el dispositivo o pegadas desde el portapapeles
- Vista previa antes de enviar
- Lightbox para ver imágenes a pantalla completa
- Panel de emojis integrado

**Notificaciones**
- Notificaciones del navegador cuando llega un mensaje con la pestaña en segundo plano
- Sonido de notificación al recibir mensajes
- Contador de mensajes no leídos por conversación

**Interfaz**
- Diseño responsive, funciona en móvil y escritorio
- Menú lateral deslizante en móvil
- Indicador de estado en línea por usuario
- Vista previa del último mensaje en la lista de contactos

---

## Variables a configurar

| Ubicación | Variable | Descripción |
|-----------|----------|-------------|
| `server.js` | `mongoose.connect(...)` | URI de conexión a MongoDB |
| `index.html` | `new WebSocket(...)` | URL del servidor WebSocket |
| `server.js` | `maxPayload` | Tamaño máximo de payload (por defecto 10 MB) |

---

## Dependencias

```json
{
  "express": "^4.x",
  "ws": "^8.x",
  "mongoose": "^7.x"
}
```

Instálalas con:

```bash
npm install express ws mongoose
```

---

## Despliegue con ngrok

Para exponer el servidor local durante desarrollo:

```bash
ngrok http 8080
```

Copia la URL generada y sustitúyela en `index.html`:

```js
socket = new WebSocket("wss://tu-subdominio.ngrok-free.app/");
```

---

## Notas

- Las imágenes se almacenan en base64 dentro de MongoDB. Para producción con alto tráfico se recomienda almacenamiento externo (S3, Cloudinary, etc.) guardando solo la URL.
- El servidor no incluye autenticación. Cualquier usuario puede entrar con cualquier nombre. Implementar un sistema de cuentas queda fuera del alcance actual del proyecto.