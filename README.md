![Logo de kiVooSpace](public/Logo_kiVooSpace.png)

<div align="center">

# kiVooSpace

**Chat privado en tiempo real · WebSockets · Node.js · MongoDB**

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![MongoDB](https://img.shields.io/badge/MongoDB-Atlas%20%2F%20Local-47A248?style=flat-square&logo=mongodb&logoColor=white)](https://www.mongodb.com/)
[![Express](https://img.shields.io/badge/Express-5.x-000000?style=flat-square&logo=express&logoColor=white)](https://expressjs.com/)
[![WebSockets](https://img.shields.io/badge/WebSockets-ws%208.x-4f46e5?style=flat-square)](https://github.com/websockets/ws)
[![PWA](https://img.shields.io/badge/PWA-Ready-5A0FC8?style=flat-square&logo=pwa&logoColor=white)](https://web.dev/progressive-web-apps/)
[![License](https://img.shields.io/badge/License-ISC-blue?style=flat-square)](LICENSE)

</div>

---

## ✨ Descripción

**kiVooSpace** es una aplicación de mensajería instantánea privada construida sobre WebSockets nativos, diseñada para ofrecer una experiencia de chat fluida y segura. Soporta conversaciones individuales y grupales, multimedia, notificaciones push y funciona como PWA instalable en cualquier dispositivo.

---

## 🚀 Funcionalidades

### 💬 Mensajería
| Característica | Descripción |
|---|---|
| Chat privado | Conversaciones 1 a 1 en tiempo real |
| Grupos | Chats grupales con gestión de miembros |
| Historial | Mensajes persistidos en MongoDB |
| Estado de entrega | Indicadores ✔ (enviado) y ✔✔ (leído) |
| Indicador de escritura | Muestra "está escribiendo..." en tiempo real |
| Responder mensajes | Sistema de reply con cita del mensaje original |
| Reenvío | Reenviar mensajes a otras conversaciones |
| Editar / Borrar | Edición y borrado suave de mensajes |
| Menciones | Menciona usuarios con `@` en grupos |
| Hilos | Conversaciones en hilo (thread) |
| Reacciones | Reacciones con emoji por mensaje |
| Mensajes destacados | Marca mensajes como favoritos |
| Autodestrucción | Mensajes con expiración automática configurable |

### 🖼️ Multimedia
- Envío de **imágenes** desde el dispositivo o pegadas desde el portapapeles
- Envío de **notas de voz** grabadas desde el chat
- Vista previa antes de enviar
- Lightbox para ver imágenes a pantalla completa
- Almacenamiento en **Cloudinary** (imágenes optimizadas en la nube)

### 🔔 Notificaciones
- **Web Push** nativo con soporte para múltiples dispositivos (móvil, PC, tablet)
- Notificación del navegador cuando la app está en segundo plano
- Sonido de notificación al recibir mensajes
- Contador de mensajes no leídos por conversación
- Cierre automático de notificaciones al abrir el chat correspondiente

### 👤 Usuarios & Privacidad
- Registro por número de teléfono + nombre de usuario + avatar
- Estado **en línea / última vez visto**
- **Bloquear** usuarios
- Archivar conversaciones
- Contactos personalizados con nombre propio

### 📱 PWA & Offline
- Instalable como app nativa en iOS, Android y escritorio
- Service Worker con estrategia **Network-first** para HTML/JS y **Cache-first** para assets
- Funciona con conectividad limitada gracias al caché inteligente

---

## 🧱 Arquitectura

```
kiVooSpace/
├── models/
│   ├── User.js          # Usuarios (teléfono, avatar, suscripciones push…)
│   ├── Message.js       # Mensajes (texto, imagen, audio, reacciones, hilos…)
│   ├── Group.js         # Grupos de chat
│   └── Contact.js       # Contactos personalizados por usuario
├── public/
│   ├── index.html       # Frontend completo (SPA)
│   ├── sw.js            # Service Worker (PWA + push)
│   ├── manifest.json    # Web App Manifest
│   └── Logo_kiVooSpace.png
├── server.js            # Servidor WebSocket + API REST
└── package.json
```

---

## 📋 Requisitos previos

- **Node.js** 18 o superior
- **MongoDB** (local o [MongoDB Atlas](https://www.mongodb.com/atlas))
- Cuenta en **Cloudinary** (para almacenamiento de imágenes en producción)
- Par de claves **VAPID** para notificaciones Web Push

---

## ⚙️ Instalación

### 1. Clonar el repositorio

```bash
git clone https://github.com/victorcu396/Chat-Propio.git
cd Chat-Propio
```

### 2. Instalar dependencias

```bash
npm install
```

### 3. Configurar variables de entorno

Crea un archivo `.env` en la raíz del proyecto:

```env
# Base de datos
MONGODB_URI=mongodb+srv://usuario:contraseña@cluster.mongodb.net/kivoospace

# Cloudinary
CLOUDINARY_CLOUD_NAME=tu_cloud_name
CLOUDINARY_API_KEY=tu_api_key
CLOUDINARY_API_SECRET=tu_api_secret

# Web Push (VAPID)
VAPID_PUBLIC_KEY=tu_clave_publica
VAPID_PRIVATE_KEY=tu_clave_privada
VAPID_EMAIL=mailto:tu@email.com

# Servidor
PORT=8080
```

> **Generar claves VAPID:**
> ```bash
> npx web-push generate-vapid-keys
> ```

### 4. Arrancar el servidor

```bash
# Producción
npm start

# Desarrollo (con recarga automática)
npm run dev
```

Abre [http://localhost:8080](http://localhost:8080) en el navegador.

---

## 🌐 Despliegue con ngrok (desarrollo local)

Para exponer el servidor durante el desarrollo y probar notificaciones push y PWA:

```bash
ngrok http 8080
```

Sustituye la URL del WebSocket en `index.html`:

```js
socket = new WebSocket("wss://tu-subdominio.ngrok-free.app/");
```

---

## 🔌 API WebSocket — Eventos principales

| Evento (cliente → servidor) | Descripción |
|---|---|
| `register` | Registrar / autenticar usuario |
| `private_message` | Enviar mensaje privado |
| `group_message` | Enviar mensaje a un grupo |
| `typing` / `stop_typing` | Indicador de escritura |
| `message_read` | Marcar mensajes como leídos |
| `edit_message` | Editar un mensaje propio |
| `delete_message` | Borrar un mensaje (soft delete) |
| `react` | Añadir / eliminar reacción |
| `star_message` | Destacar / quitar destaque |

---

## 📦 Dependencias

```json
{
  "express":    "^5.2.1",
  "ws":         "^8.19.0",
  "mongoose":   "^8.14.1",
  "cloudinary": "^2.9.0",
  "web-push":   "^3.6.7",
  "dotenv":     "^17.3.1"
}
```


## 🤝 Contribuir

Las contribuciones son bienvenidas. Por favor, abre un [issue](https://github.com/victorcu396/Chat-Propio/issues) para reportar bugs o proponer nuevas funcionalidades antes de enviar un pull request.

```bash
# Fork → rama → commit → pull request
git checkout -b feature/nueva-funcionalidad
git commit -m "feat: descripción del cambio"
git push origin feature/nueva-funcionalidad
```

---

## ⚠️ Notas importantes

> **Almacenamiento de imágenes:** En producción se utiliza Cloudinary para guardar imágenes de forma optimizada. En entornos de desarrollo sin Cloudinary configurado, las imágenes se almacenan en base64 directamente en MongoDB.

> **Autenticación:** El sistema actual usa registro por teléfono sin verificación OTP. Para producción se recomienda implementar verificación por SMS o un sistema de autenticación robusto.

---

## 📄 Licencia

Distribuido bajo la licencia **ISC**. Consulta el archivo [LICENSE](LICENSE) para más información.

---

<div align="center">

Hecho con ❤️ · [kiVooSpace](https://github.com/victorcu396/Chat-Propio)

</div>