const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

require('dotenv').config(); 
const express = require('express');

const WebSocket = require('ws');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const mongoose = require('mongoose');
const webpush = require('web-push');

const Message = require('./models/Message');
const User = require('./models/User');
const Contact = require('./models/Contact');
const Group = require('./models/Group');

const app = express();
const server = http.createServer(app);

const mongoURI = process.env.MONGODB_URI;
const port = process.env.PORT || 8080;

// ── Cloudinary (opcional) ────────────────────────────────────────────────────
// Si tienes CLOUDINARY_URL o las tres variables sueltas en el .env,
// las imágenes se suben a Cloudinary y en BD solo se guarda la URL.
// Si NO están configuradas, las imágenes se guardan como base64 (comportamiento anterior).
let cloudinary = null;
const CLOUDINARY_URL = process.env.CLOUDINARY_URL;
const CLD_CLOUD  = process.env.CLOUDINARY_CLOUD_NAME;
const CLD_KEY    = process.env.CLOUDINARY_API_KEY;
const CLD_SECRET = process.env.CLOUDINARY_API_SECRET;

if (CLOUDINARY_URL || (CLD_CLOUD && CLD_KEY && CLD_SECRET)) {
    try {
        cloudinary = require('cloudinary').v2;
        if (!CLOUDINARY_URL) {
            cloudinary.config({ cloud_name: CLD_CLOUD, api_key: CLD_KEY, api_secret: CLD_SECRET });
        }
        console.log('[Cloudinary] Configurado correctamente.');
    } catch(e) {
        console.warn('[Cloudinary] No instalado (npm install cloudinary). Usando base64.');
        cloudinary = null;
    }
}

// Helper: subir base64 a Cloudinary y devolver URL segura
async function subirImagenCloudinary(base64Data) {
    if (!cloudinary) return null;
    try {
        const result = await cloudinary.uploader.upload(base64Data, {
            folder: 'kivoospace',
            resource_type: 'image',
            transformation: [{ width: 1200, height: 1200, crop: 'limit', quality: 'auto:good', fetch_format: 'auto' }]
        });
        return result.secure_url;
    } catch(e) {
        console.error('[Cloudinary] Error al subir imagen:', e.message);
        return null;
    }
}

mongoose.connect(mongoURI)
    .then(() => console.log("MongoDB conectado"))
    .catch(err => console.error("MongoDB error:", err));

/* ── Web Push: configurar VAPID ─────────────────────────────────────────────
   Las claves VAPID se generan una sola vez y se guardan en variables de entorno.
   Si no existen, se generan automáticamente (solo válidas hasta reiniciar el proceso;
   para producción, genera unas fijas con: npx web-push generate-vapid-keys
   y guárdalas en VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY en el .env / Render env vars).
─────────────────────────────────────────────────────────────────────────────── */
let VAPID_PUBLIC_KEY  = process.env.VAPID_PUBLIC_KEY;
let VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;

if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    const vapidKeys = webpush.generateVAPIDKeys();
    VAPID_PUBLIC_KEY  = vapidKeys.publicKey;
    VAPID_PRIVATE_KEY = vapidKeys.privateKey;
    console.warn('[PUSH] Claves VAPID generadas al vuelo. Define VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY en las variables de entorno para persistencia.');
}

webpush.setVapidDetails(
    'mailto:' + (process.env.VAPID_MAILTO || 'admin@kivoospace.app'),
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
);

// Aumentar límite para base64 de imágenes (hasta ~5 MB por imagen)
const wss = new WebSocket.Server({ server, maxPayload: 10 * 1024 * 1024 });

app.use(express.json());
app.use(express.static('public'));

/* ── Health check: Render lo usa para saber que el servidor está vivo ── */
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

/* REST: cargar contactos al iniciar sesion
   GET /api/contacts?phone=+34612345678
   Enriquece cada contacto con el avatar y username del User correspondiente */
app.get('/api/contacts', async (req, res) => {
    const { phone } = req.query;
    if (!phone) return res.status(400).json({ error: 'phone requerido' });
    try {
        const contacts = await Contact.find({ ownerPhone: phone });

        // Para cada contacto buscamos su User en BD para obtener avatar y username
        const enriched = await Promise.all(contacts.map(async (c) => {
            const user = await User.findOne({ phone: c.contactPhone }).lean();
            return {
                ownerPhone:   c.ownerPhone,
                contactPhone: c.contactPhone,
                customName:   c.customName,
                avatar:       user ? user.avatar : null,
                username:     user ? user.username : null
            };
        }));

        // Incluir la lista de teléfonos bloqueados por este usuario
        const ownerUser = await User.findOne({ phone }).lean();
        const blockedPhones = ownerUser ? (ownerUser.blockedPhones || []) : [];

        res.json({ contacts: enriched, blockedPhones });
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

/* REST: cargar grupos del usuario
   GET /api/groups?phone=+34612345678 */
app.get('/api/groups', async (req, res) => {
    const { phone } = req.query;
    if (!phone) return res.status(400).json({ error: 'phone requerido' });
    try {
        const groups = await Group.find({ members: phone });
        res.json(groups);
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

/* REST: obtener datos de usuario por teléfono
   GET /api/user?phone=+34612345678
   Devuelve avatar y username guardados en BD (para sincronizar entre dispositivos) */
app.get('/api/user', async (req, res) => {
    const { phone } = req.query;
    if (!phone) return res.status(400).json({ error: 'phone requerido' });
    try {
        const user = await User.findOne({ phone }).lean();
        if (!user) return res.status(404).json({ error: 'usuario no encontrado' });
        res.json({ phone: user.phone, username: user.username, avatar: user.avatar, lastSeen: user.lastSeen || null });
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

/* REST: devolver la clave pública VAPID al cliente
   GET /api/push/vapid-public-key */
app.get('/api/push/vapid-public-key', (req, res) => {
    res.json({ publicKey: VAPID_PUBLIC_KEY });
});

/* REST: guardar suscripción push del cliente
   POST /api/push/subscribe
   Body: { phone, subscription: { endpoint, keys: { p256dh, auth } } } */
app.post('/api/push/subscribe', async (req, res) => {
    const { phone, subscription } = req.body;
    if (!phone || !subscription || !subscription.endpoint) {
        return res.status(400).json({ error: 'phone y subscription requeridos' });
    }
    try {
        const user = await User.findOne({ phone });
        if (!user) return res.status(404).json({ error: 'usuario no encontrado' });

        // Evitar duplicados: comparar por endpoint
        const exists = (user.pushSubscriptions || []).some(s => s.endpoint === subscription.endpoint);
        if (!exists) {
            user.pushSubscriptions = user.pushSubscriptions || [];
            user.pushSubscriptions.push(subscription);
            await user.save();
        }
        res.json({ ok: true });
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

/* REST: eliminar suscripción push (p.ej. al hacer logout)
   POST /api/push/unsubscribe
   Body: { phone, endpoint } */
app.post('/api/push/unsubscribe', async (req, res) => {
    const { phone, endpoint } = req.body;
    if (!phone || !endpoint) return res.status(400).json({ error: 'phone y endpoint requeridos' });
    try {
        const user = await User.findOne({ phone });
        if (user) {
            user.pushSubscriptions = (user.pushSubscriptions || []).filter(s => s.endpoint !== endpoint);
            await user.save();
        }
        res.json({ ok: true });
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

/* ── Helper: enviar notificación push a un usuario por phone ─────────────────
   Si el usuario tiene múltiples suscripciones (varios dispositivos), envía a todas.
   Elimina las suscripciones caducadas (410 Gone) automáticamente.
─────────────────────────────────────────────────────────────────────────────── */
async function enviarPushAPhone(phone, payload) {
    try {
        const user = await User.findOne({ phone }).lean();
        if (!user || !user.pushSubscriptions || user.pushSubscriptions.length === 0) return;

        const staleEndpoints = [];
        await Promise.all(user.pushSubscriptions.map(async (sub) => {
            try {
                await webpush.sendNotification(sub, JSON.stringify(payload));
            } catch(err) {
                // 410 = suscripción caducada; 404 = no existe → limpiar
                if (err.statusCode === 410 || err.statusCode === 404) {
                    staleEndpoints.push(sub.endpoint);
                }
            }
        }));

        // Limpiar suscripciones caducadas
        if (staleEndpoints.length > 0) {
            await User.updateOne(
                { phone },
                { $pull: { pushSubscriptions: { endpoint: { $in: staleEndpoints } } } }
            );
        }
    } catch(e) {
        console.error('[PUSH] enviarPushAPhone error:', e.message);
    }
}

/* ── Helper: incrementar contador de no leídos y enviar push con el total ────
   recipientPhone : teléfono del destinatario
   senderKey      : username (1:1) o 'group_'+groupId (grupo)
   payload        : objeto de notificación push (title, body, icon, badge, tag…)
                    El body se reemplaza con el texto que incluye el conteo total.
─────────────────────────────────────────────────────────────────────────────── */
async function enviarPushConConteo(recipientPhone, senderKey, payload) {
    const mapKey = `${recipientPhone}:${senderKey}`;
    const count  = (pendingUnread.get(mapKey) || 0) + 1;
    pendingUnread.set(mapKey, count);

    // Construir body con conteo: "Víctor: hola (3 sin leer)" o "1 mensaje sin leer" si solo hay 1
    const baseBody = payload.body || '…';
    const bodyConConteo = count === 1
        ? baseBody
        : `${baseBody}  ·  ${count} sin leer`;

    await enviarPushAPhone(recipientPhone, {
        ...payload,
        body: bodyConConteo,
        // El badge numérico del sistema (Chrome/Android) usa este campo
        badge: '/icon-192.png',
    });
}

/* ── Helper: resetear contador de no leídos cuando el usuario conecta o lee ──
   Se llama al hacer join/reconexión del WS (resetea todos sus pendientes)
   y cuando el cliente envía 'markRead' para un chat concreto.
─────────────────────────────────────────────────────────────────────────────── */
function resetearPendingUnread(recipientPhone, senderKey) {
    if (senderKey) {
        pendingUnread.delete(`${recipientPhone}:${senderKey}`);
    } else {
        // Resetear todos los contadores de este destinatario (al conectarse)
        for (const key of pendingUnread.keys()) {
            if (key.startsWith(recipientPhone + ':')) {
                pendingUnread.delete(key);
            }
        }
    }
}

/* REST: obtener chats archivados y configuraciones de autodestrucción
   GET /api/user/settings?phone=+34XXX */
app.get('/api/user/settings', async (req, res) => {
    const { phone } = req.query;
    if (!phone) return res.status(400).json({ error: 'phone requerido' });
    try {
        const user = await User.findOne({ phone }).lean();
        if (!user) return res.status(404).json({ error: 'no encontrado' });
        res.json({
            archivedChats:       user.archivedChats || [],
            autoDestructSettings: user.autoDestructSettings
                ? Object.fromEntries(Object.entries(user.autoDestructSettings))
                : {}
        });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

/* REST: previsualización de enlaces (Open Graph scraping)
   GET /api/link-preview?url=https://...
   Devuelve { title, description, image, domain } o error */
app.get('/api/link-preview', async (req, res) => {
    const { url } = req.query;
    if (!url || !/^https?:\/\//.test(url)) {
        return res.status(400).json({ error: 'url inválida' });
    }
    try {
        // Timeout de 5 segundos para no bloquear
        const ctrl  = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 5000);
        const resp  = await fetch(url, {
            signal:  ctrl.signal,
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; kiVooSpace/1.0; +https://kivoospace.app)' }
        });
        clearTimeout(timer);
        const html = await resp.text();

        // Extraer meta OG con regex (sin dependencia de parser HTML)
        const getMeta = (prop) => {
            // Usar string literals sin comillas simples en el patrón para evitar
            // errores de sintaxis. El patrón acepta tanto comillas dobles como simples
            // en los atributos HTML (escapadas como \x27 para la comilla simple).
            const q = '[\x22\x27]'; // clase que acepta " o '
            const val = '([^\x22\x27]*)';
            const m = html.match(new RegExp('<meta[^>]+(?:property|name)=' + q + prop + q + '[^>]+content=' + q + val + q, 'i'))
                   || html.match(new RegExp('<meta[^>]+content=' + q + val + q + '[^>]+(?:property|name)=' + q + prop + q, 'i'));
            return m ? m[1].trim() : null;
        };
        const getTitle = () => {
            const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
            return m ? m[1].trim() : null;
        };

        const title       = getMeta('og:title')       || getMeta('twitter:title')       || getTitle() || '';
        const description = getMeta('og:description') || getMeta('twitter:description') || getMeta('description') || '';
        const image       = getMeta('og:image')        || getMeta('twitter:image')        || '';
        const domain      = new URL(url).hostname.replace(/^www\./, '');

        res.json({ title: title.slice(0, 120), description: description.slice(0, 200), image, domain });
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

/* REST: exportar datos del usuario (RGPD Art. 20 - Portabilidad)
   GET /api/gdpr/export?phone=+34XXXXXXXXX */
app.get('/api/gdpr/export', async (req, res) => {
    const { phone } = req.query;
    if (!phone) return res.status(400).json({ error: 'phone requerido' });
    try {
        const user     = await User.findOne({ phone }).lean();
        if (!user) return res.status(404).json({ error: 'usuario no encontrado' });
        const contacts = await Contact.find({ ownerPhone: phone }).lean();
        const groups   = await Group.find({ members: phone }).lean();
        const messages = await Message.find({ $or: [{ from: user.username }, { to: user.username }] }).lean();
        // Eliminar datos sensibles internos antes de exportar
        const cleanUser = { ...user };
        delete cleanUser.pushSubscriptions;
        delete cleanUser._id; delete cleanUser.__v;
        const exportData = {
            exportDate:  new Date().toISOString(),
            exportedBy:  'kiVooSpace (RGPD Art. 20)',
            user:        cleanUser,
            contacts:    contacts.map(c => { const cl = { ...c }; delete cl._id; delete cl.__v; return cl; }),
            groups:      groups.map(g => { const cl = { ...g }; delete cl._id; delete cl.__v; return cl; }),
            messages:    messages.map(m => {
                const cl = { ...m };
                delete cl._id; delete cl.__v;
                delete cl.imageData; // omitir binarios grandes
                delete cl.audioData;
                return cl;
            })
        };
        res.json(exportData);
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

/* REST: eliminar cuenta del usuario (RGPD Art. 17 - Derecho al olvido)
   POST /api/gdpr/delete
   Body: { phone } */
app.post('/api/gdpr/delete', async (req, res) => {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'phone requerido' });
    try {
        const user = await User.findOne({ phone }).lean();
        if (!user) return res.status(404).json({ error: 'usuario no encontrado' });
        const { username } = user;
        // 1. Borrar usuario
        await User.deleteOne({ phone });
        // 2. Borrar contactos (como dueño y como contacto de otros)
        await Contact.deleteMany({ $or: [{ ownerPhone: phone }, { contactPhone: phone }] });
        // 3. Eliminar de grupos (si era el único miembro, borrar el grupo; si era admin, asignar otro)
        const groups = await Group.find({ members: phone });
        for (const g of groups) {
            if (g.members.length <= 1) {
                await Group.deleteOne({ groupId: g.groupId });
            } else {
                const newMembers = g.members.filter(m => m !== phone);
                const newOwner   = g.ownerPhone === phone ? newMembers[0] : g.ownerPhone;
                await Group.updateOne({ groupId: g.groupId }, { members: newMembers, ownerPhone: newOwner });
            }
        }
        // 4. Borrar mensajes (soft-delete: vaciar contenido para preservar hilos)
        await Message.updateMany(
            { $or: [{ from: username }, { to: username }] },
            { deletedAt: new Date(), message: '[cuenta eliminada]', imageData: null, audioData: null }
        );
        res.json({ ok: true, message: 'Cuenta y datos eliminados correctamente.' });
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

/* ── Rate limiting OTP: máximo 5 intentos por número cada 10 minutos ─────────
   Mapa en memoria: phone → { count, firstAt }
   Se limpia automáticamente al superar la ventana de tiempo.
────────────────────────────────────────────────────────────────────────────── */
const _otpRateMap = new Map();
const OTP_MAX    = 5;
const OTP_WINDOW = 10 * 60 * 1000; // 10 minutos

function _otpRateCheck(phone) {
    const now = Date.now();
    const entry = _otpRateMap.get(phone);
    if (!entry || (now - entry.firstAt) > OTP_WINDOW) {
        _otpRateMap.set(phone, { count: 1, firstAt: now });
        return true; // permitido
    }
    if (entry.count >= OTP_MAX) return false; // bloqueado
    entry.count++;
    return true;
}

// Limpiar entradas caducadas cada 15 minutos
setInterval(() => {
    const now = Date.now();
    _otpRateMap.forEach((v, k) => {
        if (now - v.firstAt > OTP_WINDOW) _otpRateMap.delete(k);
    });
}, 15 * 60 * 1000);

/* REST: verificar rate-limit de OTP
   POST /api/otp/check   Body: { phone }
   Devuelve { allowed: true/false } */
app.post('/api/otp/check', (req, res) => {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'phone requerido' });
    const allowed = _otpRateCheck(phone);
    if (!allowed) {
        return res.status(429).json({ allowed: false, error: 'Demasiados intentos. Espera unos minutos.' });
    }
    res.json({ allowed: true });
});

/* REST: subir imagen a Cloudinary (si está configurado) o devolver base64 tal cual
   POST /api/upload-image
   Body: { imageData: 'data:image/...' }
   Response: { url } — puede ser URL de Cloudinary o el mismo base64 si no hay Cloudinary */
app.post('/api/upload-image', async (req, res) => {
    const { imageData } = req.body;
    if (!imageData || !/^data:image\//.test(imageData)) {
        return res.status(400).json({ error: 'imageData inválido' });
    }
    try {
        if (cloudinary) {
            const url = await subirImagenCloudinary(imageData);
            if (url) return res.json({ url, type: 'cloudinary' });
        }
        // Sin Cloudinary: devolver el base64 tal cual (comportamiento anterior)
        res.json({ url: imageData, type: 'base64' });
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

server.listen(port, () =>
    console.log(`🚀 Servidor corriendo en http://localhost:${port}`)
);

/* ── Job: eliminar mensajes expirados (autodestrucción) cada minuto ────────── */
setInterval(async () => {
    try {
        const expired = await Message.find({ expiresAt: { $lte: new Date() }, deletedAt: null }).lean();
        if (!expired.length) return;
        const ids = expired.map(m => m.id);
        await Message.updateMany(
            { id: { $in: ids } },
            { deletedAt: new Date(), message: '', imageData: null, audioData: null }
        );
        // Notificar a los usuarios afectados si están conectados
        expired.forEach(m => {
            const payload = JSON.stringify({ type: 'message_deleted', id: m.id });
            [m.from, m.to].filter(Boolean).forEach(uname => {
                const uWs = users.get(uname);
                if (uWs && uWs.readyState === WebSocket.OPEN) {
                    try { uWs.send(payload); } catch(_) {}
                }
            });
        });
    } catch(e) { console.error('[AutoDestruct] Error:', e.message); }
}, 60 * 1000);

/* ── Keep-alive: evita que Render duerma el servidor en plan gratuito ──
   Render inyecta RENDER_EXTERNAL_URL automáticamente con la URL pública.
   Cada 14 minutos hacemos un ping al propio /health para mantenerlo despierto. */
const SELF_URL = process.env.RENDER_EXTERNAL_URL;
if (SELF_URL) {
    setInterval(() => {
        https.get(`${SELF_URL}/health`, (res) => {
            console.log(`[keep-alive] ping → ${res.statusCode}`);
        }).on('error', (err) => {
            console.warn('[keep-alive] error:', err.message);
        });
    }, 14 * 60 * 1000); // cada 14 minutos
}

// Map: username → WebSocket
const users = new Map();

// Map: username → phone (para info de usuario)
const userPhones = new Map();

// Map: phone → WebSocket  (para control de sesión única por número)
const phoneSessions = new Map();

// Map: pendingContactRequests toPhone → Array<{fromPhone, fromUsername, fromAvatar, id}>
const pendingContactRequests = new Map();

// Map: reqId → { newWs, phone, username, avatar, deviceInfo, createdAt }
// Solicitudes de autorización de nueva sesión pendientes de respuesta
const pendingSessionRequests = new Map();

// Map de no leídos para notificaciones push cuando el destinatario está offline/ausente.
// Estructura: 'recipientPhone:senderKey' → count
// senderKey = username para 1:1, 'group_'+groupId para grupos
// Se incrementa al enviar push y se resetea cuando el destinatario se conecta o lee el chat.
const pendingUnread = new Map();

// ── Heartbeat de aplicación (JS-level) ───────────────────────────────────
// El cliente envía 'kvs_ping' cada 15s desde JS activo.
// Si no recibimos un ping en 25s → marcamos isAway.
// Si no recibimos un ping en 55s → desconectamos (app cerrada o sin red).
// Esto es mucho más fiable que TCP ping/pong, que el SO responde aunque JS esté suspendido.
const APP_PING_AWAY    = 25000;  // 25s sin ping → ausente
const APP_PING_OFFLINE = 55000;  // 55s sin ping → desconectar

setInterval(() => {
    const now = Date.now();
    users.forEach((ws) => {
        if (!ws.lastPing) return; // aún no ha enviado su primer ping (acaba de conectar)
        const elapsed = now - ws.lastPing;

        if (elapsed > APP_PING_OFFLINE) {
            // Demasiado tiempo sin ping → dar por desconectado
            try { ws.terminate(); } catch(_) {}
            return;
        }

        const shouldBeAway = elapsed > APP_PING_AWAY;
        if (ws.isAway !== shouldBeAway) {
            ws.isAway = shouldBeAway;
            broadcastUsers();
        }
    });
}, 10000); // comprobar cada 10s

// TCP ping/pong (mantiene el socket vivo y detecta caídas de red)
const HEARTBEAT_INTERVAL = 30000;

setInterval(() => {
    users.forEach((ws) => {
        if (!ws.isAlive) {
            ws.terminate();
            return;
        }
        ws.isAlive = false;
        try { ws.ping(); } catch(_) {}
    });
    // También enviar ping a conexiones en espera de autorización de sesión
    // para que no mueran por inactividad TCP antes de que el usuario responda
    pendingSessionRequests.forEach((req) => {
        const pendingWs = req.newWs;
        if (!pendingWs || pendingWs.readyState !== WebSocket.OPEN) return;
        if (!pendingWs.isAlive) {
            // Si el WS en espera murió, limpiar la solicitud
            pendingSessionRequests.delete([...pendingSessionRequests.entries()].find(([, v]) => v.newWs === pendingWs)?.[0]);
            return;
        }
        pendingWs.isAlive = false;
        try { pendingWs.ping(); } catch(_) {}
    });
}, HEARTBEAT_INTERVAL);

wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.isAway  = false;
    ws.lastPing = Date.now(); // inicializar para que no se marque away antes del primer ping

    ws.on('pong', () => {
        ws.isAlive = true;
    });

    ws.on('message', async (rawMsg) => {

        let data;
        try {
            data = JSON.parse(rawMsg);
        } catch (e) {
            console.error("Mensaje JSON inválido:", e.message);
            return;
        }

        // ── Si este WS está esperando autorización de sesión, solo
        //    procesar kvs_ping (para mantenerlo vivo) e ignorar el resto ──
        if (ws._waitingSessionApproval) {
            if (data.type === 'kvs_ping') {
                ws.lastPing = Date.now();
                ws.isAlive  = true;
                try { ws.send(JSON.stringify({ type: 'kvs_pong' })); } catch(_) {}
            }
            return;
        }

        switch (data.type) {

            /* ──────────────────────────────────────
               JOIN (con teléfono)
            ────────────────────────────────────── */
            case 'join': {
                ws.username = data.username;
                ws.phone    = data.phone || null;

                // ── Control de sesión por número de teléfono ─────────────
                // Si ya hay una sesión activa con el mismo teléfono, pedimos
                // autorización al dispositivo existente en lugar de expulsarlo.
                if (ws.phone) {
                    const existingWs = phoneSessions.get(ws.phone);
                    if (existingWs && existingWs !== ws && existingWs.readyState === 1 /* OPEN */) {
                        // Guardar la conexión entrante como pendiente de autorización
                        const reqId = crypto.randomBytes(8).toString('hex');
                        pendingSessionRequests.set(reqId, {
                            newWs:       ws,
                            phone:       ws.phone,
                            username:    ws.username,
                            avatar:      data.avatar || null,
                            deviceInfo:  data.deviceInfo || 'Dispositivo desconocido',
                            createdAt:   Date.now()
                        });
                        ws._pendingSessionReqId = reqId;
                        // Marcar como "en espera" para que el heartbeat TCP no lo mate
                        ws._waitingSessionApproval = true;
                        ws.isAlive = true; // garantizar que no se termina en el próximo ciclo

                        // Notificar al dispositivo existente para que el usuario decida
                        try {
                            existingWs.send(JSON.stringify({
                                type:       'session_auth_request',
                                reqId,
                                username:   ws.username,
                                deviceInfo: data.deviceInfo || 'Dispositivo desconocido'
                            }));
                        } catch(_) {}
                        // Notificar al dispositivo nuevo que está esperando
                        try {
                            ws.send(JSON.stringify({
                                type: 'session_waiting_approval',
                                message: 'Esperando autorización del dispositivo activo…'
                            }));
                        } catch(_) {}
                        // Timeout de 70 s (margen extra sobre los 60 s del cliente):
                        // si no hay respuesta, cerrar limpiamente el WS en espera
                        setTimeout(() => {
                            if (pendingSessionRequests.has(reqId)) {
                                pendingSessionRequests.delete(reqId);
                                ws._waitingSessionApproval = false;
                                try {
                                    ws.send(JSON.stringify({
                                        type:    'session_rejected',
                                        message: 'El dispositivo activo no respondió a tiempo. Inténtalo de nuevo.'
                                    }));
                                } catch(_) {}
                            }
                        }, 70000);
                        break; // no continuar el join hasta que sea autorizado
                    }
                    phoneSessions.set(ws.phone, ws);
                }
                // ─────────────────────────────────────────────────────────

                // Al conectarse, resetear todos sus contadores de no leídos en push
                if (ws.phone) resetearPendingUnread(ws.phone);

                // Usar avatar personalizado si lo manda el cliente, si no dicebear
                const defaultAvatar = `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(ws.username)}`;
                if (data.avatar && /^data:image\//.test(data.avatar)) {
                    ws.avatar = data.avatar;
                } else {
                    ws.avatar = defaultAvatar;
                }

                users.set(ws.username, ws);
                if (ws.phone) userPhones.set(ws.username, ws.phone);

                // Upsert usuario en MongoDB
                try {
                    await User.findOneAndUpdate(
                        { phone: ws.phone },
                        {
                            phone: ws.phone,
                            username: ws.username,
                            avatar: ws.avatar,
                            lastLogin: new Date()
                        },
                        { upsert: true, new: true }
                    );
                } catch(e) {
                    // Si no hay phone (sesión legacy), ignorar
                }

                broadcastUsers();

                broadcast({
                    type: 'info',
                    message: `${ws.username} se ha unido al chat`
                });

                // ── Entregar mensajes pendientes (enviados mientras estaba offline) ──
                try {
                    const pending = await Message.find({
                        to:        ws.username,
                        delivered: false
                    }).sort({ time: 1 });

                    for (const msg of pending) {
                        // Enviar al destinatario (ahora online)
                        ws.send(JSON.stringify({ type: 'message', ...msg._doc }));
                        // Marcar como entregado
                        await Message.updateOne({ id: msg.id }, { delivered: true });
                        // Notificar al remitente si está online
                        const senderWs = users.get(msg.from);
                        if (senderWs && senderWs.readyState === WebSocket.OPEN) {
                            senderWs.send(JSON.stringify({ type: 'delivered', id: msg.id }));
                        }
                    }
                } catch(e) {
                    console.error('Error entregando mensajes pendientes:', e.message);
                }

                // ── Entregar missed calls pendientes ──
                try {
                    const missedCalls = await Message.find({
                        to:        ws.username,
                        delivered: false,
                        message:   '__missed_call__'
                    }).sort({ time: 1 });

                    // (ya cubierto por el loop anterior; aquí no hay trabajo extra)
                } catch(_) {}

                // ── Entregar solicitudes de contacto pendientes ──
                if (ws.phone) {
                    const pending = pendingContactRequests.get(ws.phone) || [];
                    if (pending.length > 0) {
                        for (const req of pending) {
                            try {
                                ws.send(JSON.stringify({
                                    type:        'contact_request',
                                    id:          req.id,
                                    fromPhone:   req.fromPhone,
                                    fromUsername:req.fromUsername,
                                    fromAvatar:  req.fromAvatar
                                }));
                            } catch(_) {}
                        }
                    }
                }

                break;
            }

            /* ──────────────────────────────────────
               RESPUESTA A SOLICITUD DE SESIÓN
               El dispositivo activo acepta o rechaza
               que otro dispositivo inicie sesión con
               el mismo número de teléfono.
            ────────────────────────────────────── */
            case 'session_auth_response': {
                const { reqId, accepted } = data;
                if (!reqId) break;
                const pending = pendingSessionRequests.get(reqId);
                if (!pending) break; // ya expiró o no existe
                pendingSessionRequests.delete(reqId);

                const { newWs, phone, username: newUsername, avatar: newAvatar } = pending;

                if (!accepted) {
                    // Rechazar al nuevo dispositivo
                    newWs._waitingSessionApproval = false;
                    try {
                        newWs.send(JSON.stringify({
                            type:    'session_rejected',
                            message: 'El dispositivo activo no autorizó esta sesión.'
                        }));
                    } catch(_) {}
                    break;
                }

                // Aceptado: cerrar la sesión actual y dejar entrar al nuevo
                const existingWs = phoneSessions.get(phone);
                if (existingWs && existingWs.readyState === 1) {
                    try {
                        existingWs.send(JSON.stringify({
                            type:    'session_kicked',
                            message: 'Autorizaste el acceso desde otro dispositivo. Esta sesión se cerrará.'
                        }));
                    } catch(_) {}
                    existingWs.close(4001, 'session_replaced');
                }

                // Completar el join del nuevo dispositivo
                phoneSessions.set(phone, newWs);
                newWs.phone = phone;
                newWs._waitingSessionApproval = false; // ya puede procesar mensajes normales
                newWs._pendingSessionReqId    = null;

                const defaultAvatar = `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(newUsername)}`;
                if (newAvatar && /^data:image\//.test(newAvatar)) {
                    newWs.avatar = newAvatar;
                } else {
                    newWs.avatar = defaultAvatar;
                }

                users.set(newUsername, newWs);
                if (newWs.phone) userPhones.set(newUsername, newWs.phone);

                try {
                    await User.findOneAndUpdate(
                        { phone: newWs.phone },
                        { phone: newWs.phone, username: newUsername, avatar: newWs.avatar, lastLogin: new Date() },
                        { upsert: true, new: true }
                    );
                } catch(e) {}

                // Notificar al nuevo dispositivo que fue autorizado
                try {
                    newWs.send(JSON.stringify({ type: 'session_approved' }));
                } catch(_) {}

                broadcastUsers();
                broadcast({ type: 'info', message: `${newUsername} se ha unido al chat` });

                // Entregar mensajes pendientes al nuevo dispositivo
                try {
                    const pendingMsgs = await Message.find({ to: newUsername, delivered: false }).sort({ time: 1 });
                    for (const msg of pendingMsgs) {
                        newWs.send(JSON.stringify({ type: 'message', ...msg._doc }));
                        await Message.updateOne({ id: msg.id }, { delivered: true });
                        const senderWs = users.get(msg.from);
                        if (senderWs && senderWs.readyState === WebSocket.OPEN) {
                            senderWs.send(JSON.stringify({ type: 'delivered', id: msg.id }));
                        }
                    }
                } catch(e) { console.error('Error entregando mensajes tras session_approved:', e.message); }

                // Entregar solicitudes de contacto pendientes
                if (newWs.phone) {
                    const pendingReqs = pendingContactRequests.get(newWs.phone) || [];
                    for (const req of pendingReqs) {
                        try {
                            newWs.send(JSON.stringify({
                                type: 'contact_request', id: req.id,
                                fromPhone: req.fromPhone, fromUsername: req.fromUsername, fromAvatar: req.fromAvatar
                            }));
                        } catch(_) {}
                    }
                }
                break;
            }

            /* ──────────────────────────────────────
               MESSAGE (texto + imagen opcional)
               Acepta: to (username online) o toPhone (teléfono, para offline)
            ────────────────────────────────────── */
            case 'message': {
                // Resolver destinatario: puede venir como username o como teléfono
                let recipientUsername = data.to || null;
                let recipientPhone    = data.toPhone || null;

                // Si solo viene teléfono, buscar username en BD
                if (!recipientUsername && recipientPhone) {
                    const recipientUser = await User.findOne({ phone: recipientPhone }).lean();
                    if (recipientUser) recipientUsername = recipientUser.username;
                }
                // Si solo viene username, buscar teléfono en BD (para stored conversationId)
                if (recipientUsername && !recipientPhone) {
                    const recipientUser = await User.findOne({ username: recipientUsername }).lean();
                    if (recipientUser) recipientPhone = recipientUser.phone;
                }

                if (!recipientUsername) break; // destinatario desconocido

                // ── Comprobar bloqueo: si el destinatario ha bloqueado al remitente, descartar ──
                if (recipientPhone) {
                    const recipientUserDoc = await User.findOne({ phone: recipientPhone }).lean();
                    if (recipientUserDoc && recipientUserDoc.blockedPhones && ws.phone &&
                        recipientUserDoc.blockedPhones.includes(ws.phone)) {
                        // Silencioso: el remitente no sabe que está bloqueado
                        break;
                    }
                }

                const usersSorted    = [ws.username, recipientUsername].sort();
                const conversationId = usersSorted.join('_');
                const id             = crypto.randomUUID();

                // Validar imagen base64 si viene; subir a Cloudinary si está configurado
                let imageData = null;
                if (data.imageData) {
                    if (/^data:image\/(png|jpeg|jpg|gif|webp);base64,/.test(data.imageData)) {
                        if (cloudinary) {
                            const url = await subirImagenCloudinary(data.imageData);
                            imageData = url || data.imageData;
                        } else {
                            imageData = data.imageData;
                        }
                    }
                }

                // Validar audio base64 si viene
                let audioData = null;
                if (data.audioData) {
                    if (/^data:audio\/[a-zA-Z0-9]+/.test(data.audioData)) {
                        audioData = data.audioData;
                    }
                }

                // Extraer menciones (@username) del texto
                const mentionMatches = (data.message || '').match(/@([\w\u00C0-\u017F]+)/g) || [];
                const mentions = mentionMatches.map(m => m.slice(1));

                // Calcular expiresAt si el remitente tiene autodestrucción activada para esta conversación
                let expiresAt = null;
                if (ws.phone) {
                    try {
                        const senderUser = await User.findOne({ phone: ws.phone }).lean();
                        const secs = senderUser && senderUser.autoDestructSettings
                            ? (senderUser.autoDestructSettings[conversationId] || senderUser.autoDestructSettings.get?.(conversationId))
                            : null;
                        if (secs) expiresAt = new Date(Date.now() + secs * 1000);
                    } catch(_) {}
                }

                const message = new Message({
                    id,
                    conversationId,
                    from:      ws.username,
                    to:        recipientUsername,
                    message:   data.message || '',
                    imageData,
                    audioData,
                    avatar:    ws.avatar,
                    delivered: false,
                    read:      false,
                    mentions,
                    expiresAt
                });

                await message.save();
                sendMessage(message);
                break;
            }

            /* ──────────────────────────────────────
               TYPING
            ────────────────────────────────────── */
            case 'typing': {
                if (!data.to) break;
                // ── Comprobar bloqueo: no enviar indicador de escritura si bloqueado ──
                if (ws.phone) {
                    try {
                        const typingTarget = await User.findOne({ username: data.to }).lean();
                        if (typingTarget && typingTarget.blockedPhones && typingTarget.blockedPhones.includes(ws.phone)) break;
                    } catch(_) {}
                }
                const target = users.get(data.to);
                if (target) {
                    target.send(JSON.stringify({
                        type:     'typing',
                        username: ws.username,
                        status:   data.status || 'start'
                    }));
                }
                break;
            }

            /* ──────────────────────────────────────
               GRABANDO AUDIO (1:1)
               Mismo mecanismo que typing pero para
               indicar que el usuario está grabando
               un mensaje de voz.
            ────────────────────────────────────── */
            case 'recording': {
                if (!data.to) break;
                const recTarget = users.get(data.to);
                if (recTarget && recTarget.readyState === WebSocket.OPEN) {
                    recTarget.send(JSON.stringify({
                        type:     'recording',
                        username: ws.username,
                        status:   data.status || 'start'
                    }));
                }
                break;
            }

            /* ──────────────────────────────────────
               CARGAR CONVERSACIÓN
               Acepta: with (username) o withPhone (teléfono)
            ────────────────────────────────────── */
            case 'loadConversation': {
                let withUsername = data.with || null;
                if (!withUsername && data.withPhone) {
                    const u = await User.findOne({ phone: data.withPhone }).lean();
                    if (u) withUsername = u.username;
                }
                if (!withUsername) break;

                const usersSorted    = [ws.username, withUsername].sort();
                const conversationId = usersSorted.join('_');

                // Paginación: cargar los últimos PAGE_SIZE mensajes.
                // Si viene beforeId, cargar la página anterior a ese mensaje.
                const PAGE_SIZE = 50;
                const filter = { conversationId };
                if (data.beforeId) {
                    const anchor = await Message.findOne({ id: data.beforeId }).lean();
                    if (anchor) filter.time = { $lt: anchor.time };
                }
                const history = await Message.find(filter)
                    .sort({ time: -1 })
                    .limit(PAGE_SIZE)
                    .lean();
                // Invertir para orden cronológico
                history.reverse();

                ws.send(JSON.stringify({
                    type:        'history',
                    messages:    history,
                    withUsername,
                    hasMore:     history.length === PAGE_SIZE,   // hay páginas anteriores
                    isLoadMore:  !!data.beforeId                 // es una carga adicional
                }));
                break;
            }

            /* ──────────────────────────────────────
               READ
            ────────────────────────────────────── */
            case 'read': {
                if (!data.id) break;

                await Message.updateOne(
                    { id: data.id },
                    { read: true }
                );

                const msg = await Message.findOne({ id: data.id });
                if (msg) {
                    // Si es mensaje de grupo, notificar a todos los miembros con quién leyó
                    if (msg.conversationId && msg.conversationId.startsWith('group_')) {
                        const groupId = msg.conversationId.replace('group_', '');
                        const grp = await Group.findOne({ groupId }).lean();
                        if (grp) {
                            const payload = JSON.stringify({
                                type:     'group_read',
                                id:       data.id,
                                by:       ws.username,
                                groupId
                            });
                            grp.members.forEach(memberPhone => {
                                const memberWs = [...users.values()].find(u => u.phone === memberPhone);
                                if (memberWs && memberWs.readyState === WebSocket.OPEN) {
                                    try { memberWs.send(payload); } catch(_) {}
                                }
                            });
                        }
                    } else {
                        // 1:1: notificar solo al remitente
                        const senderWs = users.get(msg.from);
                        if (senderWs) {
                            senderWs.send(JSON.stringify({ type: 'read', id: data.id }));
                        }
                    }
                }
                break;
            }

            /* ──────────────────────────────────────
               WEBRTC: OFFER
            ────────────────────────────────────── */
            case 'call_offer': {
                if (!data.to) break;
                // ── Comprobar bloqueo antes de enrutar la llamada ──
                if (ws.phone) {
                    try {
                        const callTarget = await User.findOne({ username: data.to }).lean();
                        if (callTarget && callTarget.blockedPhones && callTarget.blockedPhones.includes(ws.phone)) {
                            ws.send(JSON.stringify({ type: 'call_rejected', from: data.to }));
                            break;
                        }
                    } catch(_) {}
                }
                const target = users.get(data.to);
                if (target && target.readyState === WebSocket.OPEN) {
                    target.send(JSON.stringify({
                        type: 'call_offer',
                        from: ws.username,
                        sdp:  data.sdp
                    }));
                } else {
                    // Destinatario offline — guardar missed call en BD
                    try {
                        const recipientUser = await User.findOne({ username: data.to }).lean();
                        if (recipientUser) {
                            const usersSorted    = [ws.username, data.to].sort();
                            const conversationId = usersSorted.join('_');
                            await new Message({
                                id:             crypto.randomUUID(),
                                conversationId,
                                from:           ws.username,
                                to:             data.to,
                                message:        '__missed_call__',
                                avatar:         ws.avatar,
                                delivered:      false,
                                read:           false
                            }).save();
                        }
                    } catch(e) { console.error('missed call save error:', e.message); }

                    ws.send(JSON.stringify({
                        type: 'info',
                        message: `${data.to} no está disponible. Le llegará una notificación de llamada perdida.`
                    }));
                    // También cancelar la llamada en el caller
                    ws.send(JSON.stringify({ type: 'call_rejected', from: data.to }));
                }
                break;
            }

            /* ──────────────────────────────────────
               WEBRTC: ANSWER
            ────────────────────────────────────── */
            case 'call_answer': {
                if (!data.to) break;
                const target = users.get(data.to);
                if (target && target.readyState === WebSocket.OPEN) {
                    target.send(JSON.stringify({
                        type: 'call_answer',
                        from: ws.username,
                        sdp:  data.sdp
                    }));
                }
                break;
            }

            /* ──────────────────────────────────────
               WEBRTC: ICE CANDIDATE
            ────────────────────────────────────── */
            case 'call_ice': {
                if (!data.to) break;
                const target = users.get(data.to);
                if (target && target.readyState === WebSocket.OPEN) {
                    target.send(JSON.stringify({
                        type:      'call_ice',
                        from:      ws.username,
                        candidate: data.candidate
                    }));
                }
                break;
            }

            /* ──────────────────────────────────────
               WEBRTC: REJECTED
            ────────────────────────────────────── */
            case 'call_rejected': {
                if (!data.to) break;
                const target = users.get(data.to);
                if (target && target.readyState === WebSocket.OPEN) {
                    target.send(JSON.stringify({
                        type: 'call_rejected',
                        from: ws.username
                    }));
                }
                break;
            }

            /* ──────────────────────────────────────
               ACTUALIZAR AVATAR
            ────────────────────────────────────── */
            case 'updateAvatar': {
                if (!data.avatar) break;
                // Validar que sea un data URL de imagen
                if (!/^data:image\//.test(data.avatar)) break;
                ws.avatar = data.avatar;
                // Actualizar en MongoDB con await para garantizar persistencia
                if (ws.phone) {
                    try {
                        await User.updateOne({ phone: ws.phone }, { avatar: ws.avatar });
                    } catch(e) {
                        console.error('updateAvatar error:', e.message);
                    }
                }
                break;
            }

            /* ──────────────────────────────────────
               ACTUALIZAR AVATAR DE GRUPO (cualquier miembro)
            ────────────────────────────────────── */
            case 'updateGroupAvatar': {
                if (!data.groupId || !data.avatar) break;
                if (!ws.phone) break;
                if (!/^data:image\//.test(data.avatar)) break;
                try {
                    const grp = await Group.findOne({ groupId: data.groupId });
                    if (!grp || !grp.members.includes(ws.phone)) break;
                    grp.avatar = data.avatar;
                    await grp.save();
                    // Notificar a todos los miembros
                    const payload = JSON.stringify({ type: 'groupAvatarUpdated', groupId: data.groupId, avatar: data.avatar });
                    grp.members.forEach(memberPhone => {
                        const memberWs = [...users.values()].find(u => u.phone === memberPhone);
                        if (memberWs && memberWs.readyState === WebSocket.OPEN) memberWs.send(payload);
                    });
                } catch(e) {
                    console.error('updateGroupAvatar error:', e.message);
                }
                break;
            }

            /* ──────────────────────────────────────
               LLAMADA GRUPAL: cualquier miembro puede
               iniciar. Envía oferta a todos los demás
               miembros online del grupo.
            ────────────────────────────────────── */
            case 'group_call_offer': {
                if (!data.groupId || !data.sdp) break;
                if (!ws.phone) break;
                try {
                    const grp = await Group.findOne({ groupId: data.groupId });
                    if (!grp) break;
                    if (!grp.members.includes(ws.phone)) break; // debe ser miembro
                    // Reenviar la oferta a cada miembro online (excepto el que llama)
                    grp.members.forEach(memberPhone => {
                        if (memberPhone === ws.phone) return;
                        const memberWs = [...users.values()].find(u => u.phone === memberPhone);
                        if (memberWs && memberWs.readyState === WebSocket.OPEN) {
                            memberWs.send(JSON.stringify({
                                type:      'group_call_offer',
                                groupId:   data.groupId,
                                groupName: grp.name,
                                from:      ws.username,
                                sdp:       data.sdp
                            }));
                        }
                    });
                } catch(e) {
                    console.error('group_call_offer error:', e.message);
                }
                break;
            }

            /* ──────────────────────────────────────
               LLAMADA GRUPAL: respuesta de un miembro
            ────────────────────────────────────── */
            case 'group_call_answer': {
                if (!data.to || !data.sdp || !data.groupId) break;
                const callerWs = users.get(data.to);
                if (callerWs && callerWs.readyState === WebSocket.OPEN) {
                    callerWs.send(JSON.stringify({
                        type:    'group_call_answer',
                        from:    ws.username,
                        phone:   ws.phone,
                        groupId: data.groupId,
                        sdp:     data.sdp
                    }));
                }
                break;
            }

            /* ──────────────────────────────────────
               LLAMADA GRUPAL: ICE candidate
            ────────────────────────────────────── */
            case 'group_call_ice': {
                if (!data.to || !data.groupId) break;
                const iceTarget = users.get(data.to);
                if (iceTarget && iceTarget.readyState === WebSocket.OPEN) {
                    iceTarget.send(JSON.stringify({
                        type:      'group_call_ice',
                        from:      ws.username,
                        groupId:   data.groupId,
                        candidate: data.candidate
                    }));
                }
                break;
            }

            /* ──────────────────────────────────────
               LLAMADA GRUPAL: rechazar / colgar
            ────────────────────────────────────── */
            case 'group_call_rejected': {
                if (!data.to || !data.groupId) break;
                const rejTarget = users.get(data.to);
                if (rejTarget && rejTarget.readyState === WebSocket.OPEN) {
                    rejTarget.send(JSON.stringify({ type: 'group_call_rejected', from: ws.username, groupId: data.groupId }));
                }
                break;
            }
            case 'group_call_ended': {
                if (!data.groupId) break;
                try {
                    const grp = await Group.findOne({ groupId: data.groupId });
                    if (!grp) break;
                    grp.members.forEach(memberPhone => {
                        if (memberPhone === ws.phone) return;
                        const memberWs = [...users.values()].find(u => u.phone === memberPhone);
                        if (memberWs && memberWs.readyState === WebSocket.OPEN) {
                            memberWs.send(JSON.stringify({ type: 'group_call_ended', from: ws.username, groupId: data.groupId }));
                        }
                    });
                } catch(e) {}
                break;
            }

            /* ──────────────────────────────────────
               WEBRTC: CALL ENDED
            ────────────────────────────────────── */
            case 'call_ended': {
                if (!data.to) break;
                const target = users.get(data.to);
                if (target && target.readyState === WebSocket.OPEN) {
                    target.send(JSON.stringify({
                        type: 'call_ended',
                        from: ws.username
                    }));
                }
                break;
            }

            /* ──────────────────────────────────────
               AGREGAR CONTACTO
            ────────────────────────────────────── */
            case 'addContact': {
                // data: { contactPhone, customName }
                if (!data.contactPhone || !data.customName) break;
                if (!ws.phone) break;

                try {
                    // 1. Guardar el contacto para el usuario que lo agrega
                    await Contact.findOneAndUpdate(
                        { ownerPhone: ws.phone, contactPhone: data.contactPhone },
                        { ownerPhone: ws.phone, contactPhone: data.contactPhone, customName: data.customName },
                        { upsert: true, new: true }
                    );

                    // Confirmar al cliente que lo agregó (incluye avatar si el usuario existe)
                    const addedUser = await User.findOne({ phone: data.contactPhone }).lean();
                    ws.send(JSON.stringify({
                        type: 'contactAdded',
                        contactPhone: data.contactPhone,
                        customName: data.customName,
                        avatar:   addedUser ? addedUser.avatar : null,
                        username: addedUser ? addedUser.username : null
                    }));

                    // 2. Recíproco: si el contacto existe en BD, también guardar el contacto inverso
                    const contactUser = await User.findOne({ phone: data.contactPhone });
                    if (contactUser) {
                        // El nombre que verá el contacto inverso es el username real del que lo agrega
                        await Contact.findOneAndUpdate(
                            { ownerPhone: data.contactPhone, contactPhone: ws.phone },
                            { ownerPhone: data.contactPhone, contactPhone: ws.phone, customName: ws.username },
                            { upsert: true, new: true }
                        );

                        // Notificar al contacto si está online (incluye avatar del que lo agregó)
                        const contactWs = [...users.values()].find(u => u.phone === data.contactPhone);
                        if (contactWs && contactWs.readyState === WebSocket.OPEN) {
                            contactWs.send(JSON.stringify({
                                type: 'contactAdded',
                                contactPhone: ws.phone,
                                customName: ws.username,
                                avatar:   ws.avatar || null,
                                username: ws.username
                            }));
                        }
                    }
                } catch(e) {
                    console.error('addContact error:', e.message);
                    ws.send(JSON.stringify({ type: 'contactError', message: e.message }));
                }
                break;
            }

            /* ──────────────────────────────────────
               BLOQUEAR CONTACTO
               - Elimina el contacto de ambos lados
               - Registra el bloqueo en BD (blockedPhones)
               - Notifica al bloqueado si está online
               - El servidor impedirá que el bloqueado
                 envíe mensajes, llamadas o respuestas
                 al bloqueador
            ────────────────────────────────────── */
            case 'blockContact': {
                if (!data.contactPhone) break;
                if (!ws.phone) break;

                try {
                    // 1. Eliminar el contacto en ambas direcciones
                    await Contact.deleteOne({ ownerPhone: ws.phone, contactPhone: data.contactPhone });
                    await Contact.deleteOne({ ownerPhone: data.contactPhone, contactPhone: ws.phone });

                    // 2. Registrar el bloqueo en la BD del bloqueador
                    await User.updateOne(
                        { phone: ws.phone },
                        { $addToSet: { blockedPhones: data.contactPhone } }
                    );

                    // 3. Confirmar al bloqueador
                    ws.send(JSON.stringify({
                        type: 'contactBlocked',
                        contactPhone: data.contactPhone
                    }));

                    // 4. Notificar al bloqueado si está online
                    const blockedWs = [...users.values()].find(u => u.phone === data.contactPhone);
                    if (blockedWs && blockedWs.readyState === WebSocket.OPEN) {
                        blockedWs.send(JSON.stringify({
                            type:       'youWereBlocked',
                            byPhone:    ws.phone,
                            byUsername: ws.username
                        }));
                    }
                } catch(e) {
                    console.error('blockContact error:', e.message);
                }
                break;
            }

            /* ──────────────────────────────────────
               DESBLOQUEAR CONTACTO
               - Elimina el phone de blockedPhones del bloqueador
               - Notifica al desbloqueado si está online
            ────────────────────────────────────── */
            case 'unblockContact': {
                if (!data.contactPhone) break;
                if (!ws.phone) break;

                try {
                    await User.updateOne(
                        { phone: ws.phone },
                        { $pull: { blockedPhones: data.contactPhone } }
                    );

                    ws.send(JSON.stringify({
                        type: 'contactUnblocked',
                        contactPhone: data.contactPhone
                    }));

                    // Notificar al desbloqueado si está online
                    const unblockedWs = [...users.values()].find(u => u.phone === data.contactPhone);
                    if (unblockedWs && unblockedWs.readyState === WebSocket.OPEN) {
                        unblockedWs.send(JSON.stringify({
                            type:       'youWereUnblocked',
                            byPhone:    ws.phone,
                            byUsername: ws.username
                        }));
                    }
                } catch(e) {
                    console.error('unblockContact error:', e.message);
                }
                break;
            }

            /* ──────────────────────────────────────
               MENSAJE DE GRUPO
            ────────────────────────────────────── */
            case 'groupMessage': {
                if (!data.groupId || (!data.message && !data.imageData && !data.audioData)) break;

                const grpMsg = await Group.findOne({ groupId: data.groupId });
                if (!grpMsg) break;
                if (!grpMsg.members.includes(ws.phone)) break;

                let imageData = null;
                if (data.imageData && /^data:image\/(png|jpeg|jpg|gif|webp);base64,/.test(data.imageData)) {
                    if (cloudinary) {
                        const url = await subirImagenCloudinary(data.imageData);
                        imageData = url || data.imageData;
                    } else {
                        imageData = data.imageData;
                    }
                }
                let audioData = null;
                if (data.audioData && /^data:audio\/[a-zA-Z0-9]+/.test(data.audioData)) {
                    audioData = data.audioData;
                }

                // Extraer menciones del texto del mensaje de grupo
                const gmMentionMatches = (data.message || '').match(/@([^\s<>&"']+)/g) || [];
                let gmMentions = gmMentionMatches.map(m => m.slice(1));
                // Si hay @todos, expandir a todos los miembros del grupo
                if (gmMentions.includes('todos') || gmMentions.includes('all')) {
                    const allMemberUsernames = grpMsg.members
                        .map(phone => {
                            const u = [...users.values()].find(u => u.phone === phone);
                            return u ? u.username : null;
                        })
                        .filter(Boolean);
                    // Reemplazar @todos por la lista real + mantener otras menciones
                    gmMentions = [...new Set([
                        ...gmMentions.filter(m => m !== 'todos' && m !== 'all'),
                        ...allMemberUsernames
                    ])];
                }

                const gmId = crypto.randomUUID();
                const gmMessage = new Message({
                    id:             gmId,
                    conversationId: 'group_' + data.groupId,
                    from:           ws.username,
                    to:             data.groupId,
                    message:        data.message || '',
                    imageData,
                    audioData,
                    avatar:         ws.avatar,
                    delivered:      true,
                    read:           false,
                    mentions:       gmMentions
                });
                await gmMessage.save();

                const gmPayload = JSON.stringify({
                    type:      'groupMessage',
                    ...gmMessage._doc,
                    groupId:   data.groupId,
                    groupName: grpMsg.name
                });
                const grpPreviewText = gmMessage.imageData ? '📷 Imagen'
                    : gmMessage.audioData ? '🎙️ Audio'
                    : (gmMessage.message || '').slice(0, 80);

                grpMsg.members.forEach(memberPhone => {
                    const memberWs = [...users.values()].find(u => u.phone === memberPhone);
                    if (memberWs && memberWs.readyState === WebSocket.OPEN) {
                        memberWs.send(gmPayload);
                        // Si está en background (y no es el remitente), también push con conteo
                        if (memberWs.isAway && memberPhone !== ws.phone) {
                            enviarPushConConteo(memberPhone, 'group_' + data.groupId, {
                                title: `👥 ${grpMsg.name}`,
                                body:  `${ws.username}: ${grpPreviewText || '…'}`,
                                icon:  '/icon-192.png',
                                badge: '/icon-192.png',
                                tag:   'grp_' + data.groupId,
                                renotify: true,
                                data:  { groupId: data.groupId, chatKey: 'group_' + data.groupId }
                            });
                        }
                    } else if (memberPhone !== ws.phone) {
                        // Offline (y no es el remitente): enviar push con conteo
                        enviarPushConConteo(memberPhone, 'group_' + data.groupId, {
                            title: `👥 ${grpMsg.name}`,
                            body:  `${ws.username}: ${grpPreviewText || '…'}`,
                            icon:  '/icon-192.png',
                            badge: '/icon-192.png',
                            tag:   'grp_' + data.groupId,
                            renotify: true,
                            data:  { groupId: data.groupId, chatKey: 'group_' + data.groupId }
                        });
                    }
                });
                break;
            }

            /* ──────────────────────────────────────
               CARGAR HISTORIAL DE GRUPO
            ────────────────────────────────────── */
            case 'loadGroupConversation': {
                if (!data.groupId) break;
                const grpHist = await Group.findOne({ groupId: data.groupId });
                if (!grpHist || !grpHist.members.includes(ws.phone)) break;

                const PAGE_SIZE = 50;
                const grpFilter = { conversationId: 'group_' + data.groupId };
                if (data.beforeId) {
                    const anchor = await Message.findOne({ id: data.beforeId }).lean();
                    if (anchor) grpFilter.time = { $lt: anchor.time };
                }
                const grpHistory = await Message.find(grpFilter)
                    .sort({ time: -1 })
                    .limit(PAGE_SIZE)
                    .lean();
                grpHistory.reverse();

                ws.send(JSON.stringify({
                    type:       'groupHistory',
                    groupId:    data.groupId,
                    messages:   grpHistory,
                    hasMore:    grpHistory.length === PAGE_SIZE,
                    isLoadMore: !!data.beforeId
                }));
                break;
            }

            /* ──────────────────────────────────────
               CREAR GRUPO
            ────────────────────────────────────── */
            case 'createGroup': {
                if (!data.name || !data.memberPhones || !data.memberPhones.length) break;
                if (!ws.phone) break;

                try {
                    const newGroupId = 'g_' + crypto.randomUUID();
                    // Asegurar que el creador está en los miembros
                    const newMembers = [...new Set([ws.phone, ...data.memberPhones])];

                    const newGroup = new Group({
                        groupId:    newGroupId,
                        name:       data.name.trim(),
                        ownerPhone: ws.phone,
                        members:    newMembers
                    });
                    await newGroup.save();

                    const groupCreatedData = {
                        type:       'groupCreated',
                        groupId:    newGroupId,
                        name:       newGroup.name,
                        ownerPhone: newGroup.ownerPhone,
                        members:    newGroup.members
                    };

                    // Notificar a todos los miembros online
                    newMembers.forEach(memberPhone => {
                        const memberWs = [...users.values()].find(u => u.phone === memberPhone);
                        if (memberWs && memberWs.readyState === WebSocket.OPEN) {
                            memberWs.send(JSON.stringify(groupCreatedData));
                        }
                    });
                } catch(e) {
                    console.error('createGroup error:', e.message);
                    ws.send(JSON.stringify({ type: 'groupError', message: e.message }));
                }
                break;
            }

            /* ──────────────────────────────────────
               ELIMINAR GRUPO (solo el creador)
            ────────────────────────────────────── */
            case 'deleteGroup': {
                if (!data.groupId) break;
                if (!ws.phone) break;

                try {
                    const delGroup = await Group.findOne({ groupId: data.groupId });
                    if (!delGroup) break;
                    if (delGroup.ownerPhone !== ws.phone) {
                        ws.send(JSON.stringify({ type: 'groupError', message: 'Solo el creador puede eliminar el grupo.' }));
                        break;
                    }
                    const delMembers = [...delGroup.members];
                    await Group.deleteOne({ groupId: data.groupId });

                    const delPayload = JSON.stringify({ type: 'groupDeleted', groupId: data.groupId });
                    delMembers.forEach(memberPhone => {
                        const memberWs = [...users.values()].find(u => u.phone === memberPhone);
                        if (memberWs && memberWs.readyState === WebSocket.OPEN) {
                            memberWs.send(delPayload);
                        }
                    });
                } catch(e) {
                    console.error('deleteGroup error:', e.message);
                }
                break;
            }

            /* ──────────────────────────────────────
               SALIR DEL GRUPO
            ────────────────────────────────────── */
            case 'leaveGroup': {
                if (!data.groupId) break;
                if (!ws.phone) break;

                try {
                    const leaveGrp = await Group.findOne({ groupId: data.groupId });
                    if (!leaveGrp) break;

                    leaveGrp.members = leaveGrp.members.filter(m => m !== ws.phone);

                    // Si era el dueño y quedan miembros, pasar la propiedad al siguiente
                    if (leaveGrp.ownerPhone === ws.phone && leaveGrp.members.length > 0) {
                        leaveGrp.ownerPhone = leaveGrp.members[0];
                    }

                    if (leaveGrp.members.length === 0) {
                        await Group.deleteOne({ groupId: data.groupId });
                    } else {
                        await leaveGrp.save();
                    }

                    ws.send(JSON.stringify({ type: 'groupLeft', groupId: data.groupId }));

                    const leaveInfoPayload = JSON.stringify({
                        type:      'groupMemberLeft',
                        groupId:   data.groupId,
                        phone:     ws.phone,
                        username:  ws.username,
                        newOwner:  leaveGrp.ownerPhone
                    });
                    leaveGrp.members.forEach(memberPhone => {
                        const memberWs = [...users.values()].find(u => u.phone === memberPhone);
                        if (memberWs && memberWs.readyState === WebSocket.OPEN) {
                            memberWs.send(leaveInfoPayload);
                        }
                    });
                } catch(e) {
                    console.error('leaveGroup error:', e.message);
                }
                break;
            }

            /* ──────────────────────────────────────
               EDITAR GRUPO (renombrar + cambiar miembros)
               Solo el admin/creador puede hacerlo
            ────────────────────────────────────── */
            case 'editGroup': {
                if (!data.groupId) break;
                if (!ws.phone) break;
                try {
                    const grp = await Group.findOne({ groupId: data.groupId });
                    if (!grp) { ws.send(JSON.stringify({ type: 'groupError', message: 'Grupo no encontrado.' })); break; }
                    // Cualquier miembro puede editar nombre y foto
                    if (!grp.members.includes(ws.phone)) { ws.send(JSON.stringify({ type: 'groupError', message: 'No eres miembro de este grupo.' })); break; }

                    const oldMembers = [...grp.members];

                    if (data.name && data.name.trim()) grp.name = data.name.trim();

                    // Solo el admin puede añadir o quitar miembros
                    if (Array.isArray(data.memberPhones) && grp.ownerPhone === ws.phone) {
                        grp.members = [...new Set([ws.phone, ...data.memberPhones])];
                    }

                    await grp.save();

                    const updatedPayload = { type: 'groupUpdated', groupId: grp.groupId, name: grp.name, ownerPhone: grp.ownerPhone, members: grp.members, avatar: grp.avatar || null };
                    const allAffected = [...new Set([...oldMembers, ...grp.members])];

                    allAffected.forEach(memberPhone => {
                        const memberWs = [...users.values()].find(u => u.phone === memberPhone);
                        if (memberWs && memberWs.readyState === WebSocket.OPEN) {
                            if (!grp.members.includes(memberPhone)) {
                                memberWs.send(JSON.stringify({ type: 'groupLeft', groupId: grp.groupId }));
                            } else {
                                memberWs.send(JSON.stringify(updatedPayload));
                            }
                        }
                    });
                } catch(e) {
                    console.error('editGroup error:', e.message);
                    ws.send(JSON.stringify({ type: 'groupError', message: e.message }));
                }
                break;
            }

            /* ──────────────────────────────────────
               PING de aplicación (JS-level)
               El cliente lo envía cada 15s mientras
               la app está activa en primer plano.
               Actualiza lastPing y limpia isAway.
            ────────────────────────────────────── */
            case 'kvs_ping': {
                const wasAway = ws.isAway;
                ws.lastPing = Date.now();
                ws.isAlive  = true;
                if (ws.isAway) {
                    ws.isAway = false;
                    broadcastUsers(); // avisar a todos que volvió
                }
                // Responder con pong para que el cliente sepa que el servidor está vivo
                try { ws.send(JSON.stringify({ type: 'kvs_pong' })); } catch(_) {}
                break;
            }

            /* ──────────────────────────────────────
               MARK READ: el cliente abrió un chat concreto.
               1. Resetea el contador de no leídos push.
               2. Marca como leídos en BD todos los mensajes
                  no leídos de esa conversación dirigidos a
                  este usuario.
               3. Notifica a los remitentes (flechitas azules).
               Mensaje: { type: 'markRead', chatKey: 'username' | 'group_XXX' }
            ────────────────────────────────────── */
            case 'markRead': {
                if (!data.chatKey) break;

                // 1. Resetear contador push
                if (ws.phone) {
                    resetearPendingUnread(ws.phone, data.chatKey);
                }

                // 2. Marcar mensajes como leídos en BD y notificar remitentes
                try {
                    let conversationId;
                    if (data.chatKey.startsWith('group_')) {
                        conversationId = data.chatKey; // 'group_XXXX'
                    } else {
                        // chatKey es username del otro usuario
                        const usersSortedMR = [ws.username, data.chatKey].sort();
                        conversationId = usersSortedMR.join('_');
                    }

                    // Buscar todos los mensajes no leídos dirigidos a este usuario en esta conversación
                    let unreadMsgs;
                    if (data.chatKey.startsWith('group_')) {
                        // En grupos, 'to' es el groupId; filtrar solo los que NO son del propio usuario
                        unreadMsgs = await Message.find({
                            conversationId,
                            from: { $ne: ws.username },
                            read: false
                        }).lean();
                    } else {
                        // 1:1: solo los mensajes dirigidos a este usuario
                        unreadMsgs = await Message.find({
                            conversationId,
                            to:   ws.username,
                            read: false
                        }).lean();
                    }

                    if (unreadMsgs.length > 0) {
                        // Marcar todos como leídos en BD de una sola operación
                        if (data.chatKey.startsWith('group_')) {
                            await Message.updateMany(
                                { conversationId, from: { $ne: ws.username }, read: false },
                                { read: true }
                            );
                        } else {
                            await Message.updateMany(
                                { conversationId, to: ws.username, read: false },
                                { read: true }
                            );
                        }

                        if (data.chatKey.startsWith('group_')) {
                            // Grupo: notificar a todos los miembros que este usuario leyó
                            const groupId = data.chatKey.replace('group_', '');
                            const grp = await Group.findOne({ groupId }).lean();
                            if (grp) {
                                // Emitir group_read por cada mensaje (el cliente lo deduplica)
                                for (const msg of unreadMsgs) {
                                    const payload = JSON.stringify({
                                        type:    'group_read',
                                        id:      msg.id,
                                        by:      ws.username,
                                        groupId
                                    });
                                    grp.members.forEach(memberPhone => {
                                        const memberWs = [...users.values()].find(u => u.phone === memberPhone);
                                        if (memberWs && memberWs.readyState === WebSocket.OPEN) {
                                            try { memberWs.send(payload); } catch(_) {}
                                        }
                                    });
                                }
                            }
                        } else {
                            // 1:1: notificar al remitente de cada mensaje (puede haber varios)
                            // Agrupar por remitente para evitar duplicados de WS lookup
                            const senders = [...new Set(unreadMsgs.map(m => m.from))];
                            for (const sender of senders) {
                                const senderWs = users.get(sender);
                                if (senderWs && senderWs.readyState === WebSocket.OPEN) {
                                    // Enviar un 'read' por cada mensaje de ese remitente
                                    for (const msg of unreadMsgs.filter(m => m.from === sender)) {
                                        try {
                                            senderWs.send(JSON.stringify({ type: 'read', id: msg.id }));
                                        } catch(_) {}
                                    }
                                }
                            }
                        }
                    }
                } catch(e) {
                    console.error('markRead error:', e.message);
                }
                break;
            }

            /* ──────────────────────────────────────
               PRESENCIA: el cliente informa si está
               en primer plano (active) o en background (away).
               Se rebroadcastea a todos para actualizar los dots.
            ────────────────────────────────────── */
            case 'set_presence': {
                if (!ws.username) break;
                ws.isAway = (data.status === 'away');
                if (data.status === 'away') {
                    // No reseteamos lastPing en away — el timer de APP_PING lo gestiona
                } else {
                    ws.lastPing = Date.now(); // volvió al foreground → resetear timer
                }
                broadcastUsers();
                break;
            }

            /* ──────────────────────────────────────
               SOLICITUD DE CONTACTO
               El remitente la envía; si el destinatario
               está online la recibe al momento, si no
               queda pendiente para cuando se conecte.
            ────────────────────────────────────── */
            case 'sendContactRequest': {
                if (!data.toPhone) break;
                if (!ws.phone) break;
                if (data.toPhone === ws.phone) break;

                // Comprobar que el destinatario existe en BD
                const reqTargetUser = await User.findOne({ phone: data.toPhone }).lean();
                if (!reqTargetUser) {
                    ws.send(JSON.stringify({
                        type: 'contactRequestError',
                        message: 'Usuario no encontrado. Comprueba el número.'
                    }));
                    break;
                }

                // Comprobar que no es ya un contacto del remitente
                const alreadyContact = await Contact.findOne({
                    ownerPhone:   ws.phone,
                    contactPhone: data.toPhone
                });
                if (alreadyContact) {
                    ws.send(JSON.stringify({
                        type: 'contactRequestError',
                        message: 'Este usuario ya está en tus contactos.'
                    }));
                    break;
                }

                const reqId = crypto.randomUUID();
                const reqPayload = {
                    type:        'contact_request',
                    id:          reqId,
                    fromPhone:   ws.phone,
                    fromUsername:ws.username,
                    fromAvatar:  ws.avatar || null
                };

                // Intentar entrega inmediata si está online
                const reqTargetWs = [...users.values()].find(u => u.phone === data.toPhone);
                if (reqTargetWs && reqTargetWs.readyState === WebSocket.OPEN) {
                    try { reqTargetWs.send(JSON.stringify(reqPayload)); } catch(_) {}
                } else {
                    // Guardar para entrega al reconectar
                    const list = pendingContactRequests.get(data.toPhone) || [];
                    // Evitar duplicados del mismo remitente
                    const idx = list.findIndex(r => r.fromPhone === ws.phone);
                    if (idx >= 0) list.splice(idx, 1);
                    list.push({ id: reqId, fromPhone: ws.phone, fromUsername: ws.username, fromAvatar: ws.avatar || null });
                    pendingContactRequests.set(data.toPhone, list);
                }

                // Confirmar al remitente
                ws.send(JSON.stringify({ type: 'contactRequestSent', toPhone: data.toPhone }));
                break;
            }

            /* ──────────────────────────────────────
               RESPONDER SOLICITUD DE CONTACTO
               accepted: true  → agrega contacto en ambos lados
               accepted: false → descarta la solicitud
            ────────────────────────────────────── */
            case 'respondContactRequest': {
                if (!data.fromPhone || typeof data.accepted === 'undefined') break;
                if (!ws.phone) break;

                // Limpiar de pendientes siempre
                const reqList = pendingContactRequests.get(ws.phone) || [];
                const filtered = reqList.filter(r => r.fromPhone !== data.fromPhone);
                if (filtered.length > 0) {
                    pendingContactRequests.set(ws.phone, filtered);
                } else {
                    pendingContactRequests.delete(ws.phone);
                }

                if (!data.accepted) {
                    // Solo notificar al remitente si está online (rechazo silencioso)
                    const rejWs = [...users.values()].find(u => u.phone === data.fromPhone);
                    if (rejWs && rejWs.readyState === WebSocket.OPEN) {
                        try {
                            rejWs.send(JSON.stringify({
                                type:    'contactRequestRejected',
                                byPhone: ws.phone,
                                byUsername: ws.username
                            }));
                        } catch(_) {}
                    }
                    break;
                }

                // ── Aceptar: agregar contacto en ambos lados ──────────────
                try {
                    const fromUser = await User.findOne({ phone: data.fromPhone }).lean();
                    const fromName = fromUser ? fromUser.username : data.fromPhone;

                    // 1. El que acepta agrega al solicitante
                    await Contact.findOneAndUpdate(
                        { ownerPhone: ws.phone, contactPhone: data.fromPhone },
                        { ownerPhone: ws.phone, contactPhone: data.fromPhone, customName: fromName },
                        { upsert: true, new: true }
                    );
                    ws.send(JSON.stringify({
                        type:         'contactAdded',
                        contactPhone: data.fromPhone,
                        customName:   fromName,
                        avatar:       fromUser ? fromUser.avatar : null,
                        username:     fromUser ? fromUser.username : null
                    }));

                    // 2. El solicitante agrega al que aceptó
                    await Contact.findOneAndUpdate(
                        { ownerPhone: data.fromPhone, contactPhone: ws.phone },
                        { ownerPhone: data.fromPhone, contactPhone: ws.phone, customName: ws.username },
                        { upsert: true, new: true }
                    );
                    const acceptorUser = await User.findOne({ phone: ws.phone }).lean();
                    const fromWs = [...users.values()].find(u => u.phone === data.fromPhone);
                    if (fromWs && fromWs.readyState === WebSocket.OPEN) {
                        fromWs.send(JSON.stringify({
                            type:         'contactAdded',
                            contactPhone: ws.phone,
                            customName:   ws.username,
                            avatar:       ws.avatar || null,
                            username:     ws.username
                        }));
                        // Notificar al solicitante que fue aceptado
                        fromWs.send(JSON.stringify({
                            type:        'contactRequestAccepted',
                            byPhone:     ws.phone,
                            byUsername:  ws.username,
                            byAvatar:    ws.avatar || null
                        }));
                    }
                } catch(e) {
                    console.error('respondContactRequest error:', e.message);
                }
                break;
            }

            /* ──────────────────────────────────────
               EDITAR MENSAJE
            ────────────────────────────────────── */
            case 'editMessage': {
                if (!data.id || !data.newText) break;
                try {
                    const msg = await Message.findOne({ id: data.id });
                    if (!msg || msg.from !== ws.username) break;
                    if (msg.deletedAt) break;
                    msg.message = data.newText;
                    msg.editedAt = new Date();
                    await msg.save();
                    const payload = JSON.stringify({ type: 'message_edited', id: data.id, newText: data.newText, editedAt: msg.editedAt });
                    broadcastToConversation(msg.conversationId, payload, msg.from, msg.to);
                } catch(e) { console.error('editMessage error:', e.message); }
                break;
            }

            /* ──────────────────────────────────────
               BORRAR MENSAJE (borrado suave)
            ────────────────────────────────────── */
            case 'deleteMessage': {
                if (!data.id) break;
                try {
                    const msg = await Message.findOne({ id: data.id });
                    if (!msg) break;
                    // Permitir borrar si: eres el remitente, O eres admin del grupo
                    const isAuthor = msg.from === ws.username;
                    let isGroupAdmin = false;
                    if (!isAuthor && msg.conversationId && msg.conversationId.startsWith('group_')) {
                        const grpId = msg.conversationId.replace('group_', '');
                        const grp   = await Group.findOne({ groupId: grpId });
                        if (grp && grp.ownerPhone === ws.phone) isGroupAdmin = true;
                    }
                    if (!isAuthor && !isGroupAdmin) break;
                    msg.deletedAt = new Date();
                    msg.message   = '';
                    msg.imageData = null;
                    msg.audioData = null;
                    await msg.save();
                    const payload = JSON.stringify({ type: 'message_deleted', id: data.id });
                    broadcastToConversation(msg.conversationId, payload, msg.from, msg.to);
                } catch(e) { console.error('deleteMessage error:', e.message); }
                break;
            }

            /* Borrado múltiple de mensajes — batch optimizado */
            case 'deleteMessages': {
                if (!Array.isArray(data.ids) || data.ids.length === 0) break;
                // Limitar a 100 mensajes por petición para evitar abuso
                const ids = data.ids.slice(0, 100);
                try {
                    // Una sola consulta para obtener todos los mensajes
                    const msgs = await Message.find({ id: { $in: ids } });
                    const toDelete = [];

                    // Caché de grupos ya consultados para no repetir queries
                    const groupAdminCache = {};

                    for (const msg of msgs) {
                        if (msg.deletedAt) continue;
                        const isAuthor = msg.from === ws.username;
                        let isGroupAdmin = false;
                        if (!isAuthor && msg.conversationId && msg.conversationId.startsWith('group_')) {
                            const grpId = msg.conversationId.replace('group_', '');
                            if (groupAdminCache[grpId] === undefined) {
                                const grp = await Group.findOne({ groupId: grpId }).lean();
                                groupAdminCache[grpId] = grp ? grp.ownerPhone === ws.phone : false;
                            }
                            isGroupAdmin = groupAdminCache[grpId];
                        }
                        if (!isAuthor && !isGroupAdmin) continue;
                        toDelete.push(msg);
                    }

                    if (toDelete.length > 0) {
                        const deleteIds = toDelete.map(m => m.id);
                        // Una sola operación de escritura en BD
                        await Message.updateMany(
                            { id: { $in: deleteIds } },
                            { deletedAt: new Date(), message: '', imageData: null, audioData: null }
                        );
                        // Notificar a todos los participantes afectados
                        const payload = JSON.stringify({ type: 'messages_deleted', ids: deleteIds });
                        const convIds = [...new Set(toDelete.map(m => m.conversationId))];
                        convIds.forEach(convId => {
                            const msgsInConv = toDelete.filter(m => m.conversationId === convId);
                            const from = msgsInConv[0]?.from;
                            const to   = msgsInConv[0]?.to;
                            broadcastToConversation(convId, payload, from, to);
                        });
                    }
                } catch(e) { console.error('deleteMessages error:', e.message); }
                break;
            }

            /* ──────────────────────────────────────
               REACCIÓN A MENSAJE
            ────────────────────────────────────── */
            case 'addReaction': {
                if (!data.id || !data.emoji) break;
                try {
                    const msg = await Message.findOne({ id: data.id });
                    if (!msg || msg.deletedAt) break;
                    const reactions = msg.reactions || new Map();
                    const users_reacted = reactions.get(data.emoji) || [];
                    const idx = users_reacted.indexOf(ws.username);
                    if (idx >= 0) {
                        users_reacted.splice(idx, 1); // toggle off
                    } else {
                        users_reacted.push(ws.username); // toggle on
                    }
                    if (users_reacted.length === 0) {
                        reactions.delete(data.emoji);
                    } else {
                        reactions.set(data.emoji, users_reacted);
                    }
                    msg.reactions = reactions;
                    msg.markModified('reactions');
                    await msg.save();
                    const reactObj = {};
                    msg.reactions.forEach((v, k) => { reactObj[k] = v; });
                    const payload = JSON.stringify({ type: 'message_reaction', id: data.id, reactions: reactObj });
                    broadcastToConversation(msg.conversationId, payload, msg.from, msg.to);
                } catch(e) { console.error('addReaction error:', e.message); }
                break;
            }

            /* ──────────────────────────────────────
               DESTACAR / QUITAR DESTAQUE
            ────────────────────────────────────── */
            case 'starMessage': {
                if (!data.id) break;
                try {
                    const msg = await Message.findOne({ id: data.id });
                    if (!msg) break;
                    const idx = (msg.starredBy || []).indexOf(ws.username);
                    if (idx >= 0) {
                        msg.starredBy.splice(idx, 1);
                    } else {
                        msg.starredBy.push(ws.username);
                    }
                    await msg.save();
                    ws.send(JSON.stringify({ type: 'message_starred', id: data.id, starred: msg.starredBy.includes(ws.username) }));
                } catch(e) { console.error('starMessage error:', e.message); }
                break;
            }

            /* ──────────────────────────────────────
               REENVIAR MENSAJE
               Crea un nuevo mensaje en la conversación
               destino con referencia al original.
            ────────────────────────────────────── */
            case 'forwardMessage': {
                if (!data.id) break;
                if (!data.to && !data.toPhone && !data.groupId) break;
                try {
                    const orig = await Message.findOne({ id: data.id });
                    if (!orig || orig.deletedAt) break;

                    let recipientUsername = data.to || null;
                    let recipientPhone    = data.toPhone || null;
                    let conversationId;
                    let groupId = data.groupId || null;

                    if (groupId) {
                        conversationId = 'group_' + groupId;
                    } else {
                        if (!recipientUsername && recipientPhone) {
                            const u = await User.findOne({ phone: recipientPhone }).lean();
                            if (u) recipientUsername = u.username;
                        }
                        if (!recipientUsername) break;
                        // ── Comprobar bloqueo en forwardMessage ──
                        if (recipientPhone && ws.phone) {
                            const recDoc = await User.findOne({ phone: recipientPhone }).lean();
                            if (recDoc && recDoc.blockedPhones && recDoc.blockedPhones.includes(ws.phone)) break;
                        } else if (recipientUsername && ws.phone) {
                            const recDoc = await User.findOne({ username: recipientUsername }).lean();
                            if (recDoc && recDoc.blockedPhones && recDoc.blockedPhones.includes(ws.phone)) break;
                        }
                        conversationId = [ws.username, recipientUsername].sort().join('_');
                    }

                    const newId = crypto.randomUUID();
                    const fwdMsg = new Message({
                        id:             newId,
                        conversationId,
                        from:           ws.username,
                        to:             recipientUsername || groupId,
                        message:        orig.message,
                        imageData:      orig.imageData,
                        audioData:      orig.audioData,
                        avatar:         ws.avatar,
                        forwardedFrom:  orig.from,
                        delivered:      false,
                        read:           false
                    });
                    await fwdMsg.save();

                    if (groupId) {
                        const grp = await Group.findOne({ groupId });
                        if (!grp) break;
                        const gmPayload = JSON.stringify({ type: 'groupMessage', ...fwdMsg._doc, groupId, groupName: grp.name });
                        grp.members.forEach(mp => {
                            const mws = [...users.values()].find(u => u.phone === mp);
                            if (mws && mws.readyState === WebSocket.OPEN) mws.send(gmPayload);
                        });
                    } else {
                        sendMessage(fwdMsg);
                    }
                } catch(e) { console.error('forwardMessage error:', e.message); }
                break;
            }

            /* ──────────────────────────────────────
               RESPONDER A MENSAJE
               Igual que 'message' pero con replyToId.
            ────────────────────────────────────── */
            case 'replyMessage': {
                if (!data.replyToId) break;
                let recipientUsername = data.to || null;
                let recipientPhone    = data.toPhone || null;
                const groupId         = data.groupId || null;

                try {
                    const orig = await Message.findOne({ id: data.replyToId }).lean();
                    if (!orig) break;

                    let conversationId;
                    if (groupId) {
                        conversationId = 'group_' + groupId;
                    } else {
                        if (!recipientUsername && recipientPhone) {
                            const u = await User.findOne({ phone: recipientPhone }).lean();
                            if (u) recipientUsername = u.username;
                        }
                        if (!recipientUsername) break;
                        // ── Comprobar bloqueo en replyMessage ──
                        if (recipientPhone && ws.phone) {
                            const recDoc = await User.findOne({ phone: recipientPhone }).lean();
                            if (recDoc && recDoc.blockedPhones && recDoc.blockedPhones.includes(ws.phone)) break;
                        } else if (recipientUsername && ws.phone) {
                            const recDoc = await User.findOne({ username: recipientUsername }).lean();
                            if (recDoc && recDoc.blockedPhones && recDoc.blockedPhones.includes(ws.phone)) break;
                        }
                        conversationId = [ws.username, recipientUsername].sort().join('_');
                    }

                    let imageData = null;
                    if (data.imageData && /^data:image\/(png|jpeg|jpg|gif|webp);base64,/.test(data.imageData)) {
                        if (cloudinary) {
                            const url = await subirImagenCloudinary(data.imageData);
                            imageData = url || data.imageData;
                        } else {
                            imageData = data.imageData;
                        }
                    }

                    const newId = crypto.randomUUID();
                    const replyMsg = new Message({
                        id:           newId,
                        conversationId,
                        from:         ws.username,
                        to:           recipientUsername || groupId,
                        message:      data.message || '',
                        imageData,
                        avatar:       ws.avatar,
                        replyToId:    data.replyToId,
                        replyToFrom:  orig.from,
                        replyToText:  orig.deletedAt ? '🗑 Mensaje eliminado' : (orig.imageData ? '📷 Imagen' : orig.audioData ? '🎙 Audio' : (orig.message || '').slice(0, 80)),
                        delivered:    false,
                        read:         false
                    });
                    await replyMsg.save();

                    if (groupId) {
                        const grp = await Group.findOne({ groupId });
                        if (!grp || !grp.members.includes(ws.phone)) break;
                        const gmPayload = JSON.stringify({ type: 'groupMessage', ...replyMsg._doc, groupId, groupName: grp.name });
                        grp.members.forEach(mp => {
                            const mws = [...users.values()].find(u => u.phone === mp);
                            if (mws && mws.readyState === WebSocket.OPEN) mws.send(gmPayload);
                        });
                    } else {
                        sendMessage(replyMsg);
                    }
                } catch(e) { console.error('replyMessage error:', e.message); }
                break;
            }

            /* ──────────────────────────────────────
               HILO (THREAD)
               Crea un mensaje dentro del hilo de otro.
               El mensaje raíz incrementa threadCount.
            ────────────────────────────────────── */
            case 'threadMessage': {
                if (!data.threadId || !data.message) break;
                try {
                    const root = await Message.findOne({ id: data.threadId });
                    if (!root || root.deletedAt) break;

                    const newId = crypto.randomUUID();
                    const threadMsg = new Message({
                        id:             newId,
                        conversationId: root.conversationId,
                        from:           ws.username,
                        to:             root.to,
                        message:        data.message,
                        avatar:         ws.avatar,
                        threadId:       data.threadId,
                        delivered:      true,
                        read:           false
                    });
                    await threadMsg.save();

                    root.threadCount = (root.threadCount || 0) + 1;
                    await root.save();

                    const payload = JSON.stringify({ type: 'thread_message', msg: threadMsg._doc, threadId: data.threadId, threadCount: root.threadCount });
                    broadcastToConversation(root.conversationId, payload, root.from, root.to);
                } catch(e) { console.error('threadMessage error:', e.message); }
                break;
            }

            /* ──────────────────────────────────────
               CARGAR HILO
            ────────────────────────────────────── */
            case 'loadThread': {
                if (!data.threadId) break;
                try {
                    const replies = await Message.find({ threadId: data.threadId }).sort({ time: 1 });
                    ws.send(JSON.stringify({ type: 'thread_history', threadId: data.threadId, messages: replies }));
                } catch(e) { console.error('loadThread error:', e.message); }
                break;
            }

            /* ──────────────────────────────────────
               BORRAR CONVERSACIÓN COMPLETA
               Borra suavemente todos los mensajes de
               una conversación para el usuario que lo pide.
            ────────────────────────────────────── */
            case 'clearConversation': {
                if (!data.conversationId) break;
                if (!ws.username) break;
                try {
                    // Borrado suave: marcar todos los mensajes como eliminados
                    await Message.updateMany(
                        { conversationId: data.conversationId, deletedAt: null },
                        { deletedAt: new Date(), message: '', imageData: null, audioData: null }
                    );
                    ws.send(JSON.stringify({ type: 'conversation_cleared', conversationId: data.conversationId }));
                } catch(e) { console.error('clearConversation error:', e.message); }
                break;
            }

            /* ──────────────────────────────────────
               CONFIGURAR AUTODESTRUCCIÓN
               Guarda el tiempo de autodestrucción para
               una conversación concreta del usuario.
               seconds = 0 desactiva.
            ────────────────────────────────────── */
            case 'setAutoDestruct': {
                if (!data.conversationId || data.seconds === undefined) break;
                if (!ws.phone) break;
                try {
                    const seconds = parseInt(data.seconds, 10) || 0;
                    if (seconds === 0) {
                        await User.updateOne({ phone: ws.phone }, { $unset: { [`autoDestructSettings.${data.conversationId}`]: '' } });
                    } else {
                        await User.updateOne({ phone: ws.phone }, { $set: { [`autoDestructSettings.${data.conversationId}`]: seconds } });
                    }
                    ws.send(JSON.stringify({ type: 'auto_destruct_set', conversationId: data.conversationId, seconds }));
                } catch(e) { console.error('setAutoDestruct error:', e.message); }
                break;
            }

            /* ──────────────────────────────────────
               AUDIO ESCUCHADO
               El receptor notifica que escuchó un audio.
            ────────────────────────────────────── */
            case 'audioRead': {
                if (!data.id) break;
                if (!ws.username) break;
                try {
                    const aMsg = await Message.findOne({ id: data.id });
                    if (!aMsg || aMsg.deletedAt) break;
                    if (!aMsg.audioReadBy.includes(ws.username)) {
                        aMsg.audioReadBy.push(ws.username);
                        await aMsg.save();
                    }
                    // Notificar al remitente que fue escuchado
                    const senderWs = users.get(aMsg.from);
                    if (senderWs && senderWs.readyState === WebSocket.OPEN) {
                        senderWs.send(JSON.stringify({ type: 'audio_read', id: data.id, by: ws.username }));
                    }
                } catch(e) { console.error('audioRead error:', e.message); }
                break;
            }

            /* ──────────────────────────────────────
               ARCHIVAR / DESARCHIVAR CONVERSACIÓN
            ────────────────────────────────────── */
            case 'archiveChat': {
                if (!data.conversationId) break;
                if (!ws.phone) break;
                try {
                    const action = data.archive ? '$addToSet' : '$pull';
                    await User.updateOne({ phone: ws.phone }, { [action]: { archivedChats: data.conversationId } });
                    ws.send(JSON.stringify({ type: 'chat_archived', conversationId: data.conversationId, archived: !!data.archive }));
                } catch(e) { console.error('archiveChat error:', e.message); }
                break;
            }

            /* ──────────────────────────────────────
               RENOMBRAR CONTACTO
               Solo actualiza el customName del dueño.
               El contacto no se entera: cada uno ve
               el nombre que él mismo le ha puesto.
            ────────────────────────────────────── */
            case 'renameContact': {
                if (!data.contactPhone || !data.newName) break;
                if (!ws.phone) break;

                try {
                    const updated = await Contact.findOneAndUpdate(
                        { ownerPhone: ws.phone, contactPhone: data.contactPhone },
                        { customName: data.newName.trim() },
                        { new: true }
                    );

                    if (!updated) {
                        ws.send(JSON.stringify({ type: 'contactError', message: 'Contacto no encontrado.' }));
                        break;
                    }

                    ws.send(JSON.stringify({
                        type: 'contactRenamed',
                        contactPhone: data.contactPhone,
                        newName: updated.customName
                    }));
                } catch(e) {
                    console.error('renameContact error:', e.message);
                    ws.send(JSON.stringify({ type: 'contactError', message: e.message }));
                }
                break;
            }
        }
    });

    ws.on('close', () => {
        if (ws.username) {
            users.delete(ws.username);
            userPhones.delete(ws.username);
            // Limpiar sesión activa solo si este WS es el actual para ese teléfono
            if (ws.phone && phoneSessions.get(ws.phone) === ws) {
                phoneSessions.delete(ws.phone);
            }
            // Limpiar solicitudes de sesión pendientes cuyo nuevo WS es este
            if (ws._pendingSessionReqId) {
                pendingSessionRequests.delete(ws._pendingSessionReqId);
            }
            // Actualizar lastSeen al desconectarse
            if (ws.phone) {
                const lastSeenNow = new Date();
                User.updateOne({ phone: ws.phone }, { lastSeen: lastSeenNow }).exec();
                // Notificar a los contactos que tengan este chat abierto
                broadcast({ type: 'user_last_seen', username: ws.username, lastSeen: lastSeenNow.toISOString() });
            }
            broadcastUsers();
            broadcast({
                type:    'info',
                message: `${ws.username} salió del chat`
            });
        }
    });

    ws.on('error', (err) => {
        console.error(`Error WebSocket (${ws.username}):`, err.message);
    });
});

/* ──────────────────────────────────────
   HELPERS
────────────────────────────────────── */
function sendMessage(message) {
    const payload = JSON.stringify({
        type: 'message',
        ...message._doc
    });

    // Enviar al remitente siempre (para que aparezca en su chat)
    const senderWs = users.get(message.from);
    if (senderWs && senderWs.readyState === WebSocket.OPEN) {
        senderWs.send(payload);
    }

    // Enviar al destinatario si está online
    const targetWs = users.get(message.to);
    if (targetWs && targetWs.readyState === WebSocket.OPEN && targetWs !== senderWs) {
        targetWs.send(payload);
        // Marcar como entregado
        Message.updateOne({ id: message.id }, { delivered: true }).exec();
        if (senderWs && senderWs.readyState === WebSocket.OPEN) {
            senderWs.send(JSON.stringify({ type: 'delivered', id: message.id }));
        }
        // Si el destinatario está online pero en background (isAway), enviar push también
        if (targetWs.isAway && targetWs.phone) {
            const previewText = message.imageData ? '📷 Imagen'
                : message.audioData ? '🎙️ Audio'
                : (message.message || '').slice(0, 80);
            enviarPushConConteo(targetWs.phone, message.from, {
                title: `💬 ${message.from}`,
                body:  previewText || '…',
                icon:  '/icon-192.png',
                badge: '/icon-192.png',
                tag:   'msg_' + message.from,
                renotify: true,
                data:  { from: message.from, chatKey: message.from }
            });
        }
    } else if (!targetWs || targetWs.readyState !== WebSocket.OPEN) {
        // Si offline: el mensaje queda en BD con delivered:false
        // Enviar notificación push para que le llegue aunque tenga la app cerrada
        User.findOne({ username: message.to }).lean().then(recipientUser => {
            if (!recipientUser || !recipientUser.phone) return;
            const previewText = message.imageData ? '📷 Imagen'
                : message.audioData ? '🎙️ Audio'
                : (message.message || '').slice(0, 80);
            enviarPushConConteo(recipientUser.phone, message.from, {
                title: `💬 ${message.from}`,
                body:  previewText || '…',
                icon:  '/icon-192.png',
                badge: '/icon-192.png',
                tag:   'msg_' + message.from,
                renotify: true,
                data:  { from: message.from, chatKey: message.from }
            });
        }).catch(() => {});
    }
}

function broadcastUsers() {
    // Filtrar sockets que aún no han enviado 'join' (username vacío o nulo)
    const onlineWithAvatars = [...users.entries()]
        .filter(([name]) => name && typeof name === 'string' && name.trim() !== '')
        .map(([name, ws]) => ({
            username: name,
            avatar:   ws.avatar || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(name)}`,
            phone:    ws.phone || null,
            isAway:   ws.isAway || false
        }));
    // Enviar a cada usuario la lista SIN él mismo incluido
    users.forEach((ws) => {
        if (ws.readyState !== 1 /* OPEN */) return;
        const listForThisUser = onlineWithAvatars.filter(u => u.username !== ws.username);
        try {
            ws.send(JSON.stringify({ type: 'users', online: listForThisUser }));
        } catch(_) {}
    });
}

function broadcast(data) {
    const payload = JSON.stringify(data);
    users.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(payload);
        }
    });
}

// Enviar a todos los usuarios de una conversación (1:1 o grupo)
// Para 1:1: busca el mensaje en BD para obtener from/to, luego envía a ambos si están online.
// Para grupos: envía a todos los miembros online.
async function broadcastToConversationAsync(conversationId, payload, msgFrom, msgTo) {
    if (conversationId.startsWith('group_')) {
        const groupId = conversationId.replace('group_', '');
        try {
            const grp = await Group.findOne({ groupId });
            if (!grp) return;
            grp.members.forEach(memberPhone => {
                const memberWs = [...users.values()].find(u => u.phone === memberPhone);
                if (memberWs && memberWs.readyState === WebSocket.OPEN) {
                    try { memberWs.send(payload); } catch(_) {}
                }
            });
        } catch(_) {}
    } else {
        // 1:1: enviar a from y to (ambos pueden estar online)
        [msgFrom, msgTo].filter(Boolean).forEach(uname => {
            const uWs = users.get(uname);
            if (uWs && uWs.readyState === WebSocket.OPEN) {
                try { uWs.send(payload); } catch(_) {}
            }
        });
    }
}

function broadcastToConversation(conversationId, payload, msgFrom, msgTo) {
    broadcastToConversationAsync(conversationId, payload, msgFrom, msgTo).catch(() => {});
}