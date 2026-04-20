const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
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

app.use(express.json({ limit: '15mb' }));
app.use(express.static('public'));

/* ============================================================
   HANDLERS — cada grupo de mensajes en su propio archivo
============================================================ */
const handleAuth      = require('./server/handlers/auth');
const handlePresence  = require('./server/handlers/presence');
const handleMessages  = require('./server/handlers/messages');
const handleCalls     = require('./server/handlers/calls');
const handleContacts  = require('./server/handlers/contacts');
const handleGroups    = require('./server/handlers/groups');
const handleReactions = require('./server/handlers/reactions');
const handleThreads   = require('./server/handlers/threads');


/* ── Health check: Render lo usa para saber que el servidor está vivo ── */


/* ============================================================
   EXPRESS API ROUTES
============================================================ */

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



/* ============================================================
   STATE — WebSocket maps, admin config, heartbeat
============================================================ */

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

// ── Teléfono del administrador ────────────────────────────────────────────────
// El admin puede ver a TODOS los usuarios conectados aunque no los tenga en contactos.
// El resto de usuarios solo ven en "conectados" a quienes tienen en su lista de contactos.
const ADMIN_PHONE = '693001834';
// isAdmin: compara con endsWith para cubrir formatos con/sin prefijo (+34693001834 o 693001834)
function isAdmin(phone) {
    if (!phone) return false;
    return phone === ADMIN_PHONE || phone.endsWith(ADMIN_PHONE);
}

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
            broadcastUsers().catch(e => console.error("[broadcastUsers]", e.message));
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



/* ============================================================
   WEBSOCKET SERVER — connection handler
============================================================ */

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



/* ============================================================
   MESSAGE ROUTER — switch(data.type)
============================================================ */

        // ── Contexto compartido para todos los handlers ──────────
        const ctx = {
            users, userPhones, phoneSessions, pendingSessionRequests,
            pendingContactRequests, pendingUnread,
            Message, User, Contact, Group,
            crypto, webpush, cloudinary, subirImagenCloudinary,
            WebSocket,
            sendMessage, broadcastUsers, broadcastInfoFiltered,
            broadcastToConversation, enviarPushAPhone, enviarPushConConteo,
            resetearPendingUnread,
            isAdmin, ADMIN_PHONE,
        };

        // ── Enrutar mensaje al handler correspondiente ───────────
        await handleAuth(data, ws, ctx);
        await handlePresence(data, ws, ctx);
        await handleMessages(data, ws, ctx);
        await handleCalls(data, ws, ctx);
        await handleContacts(data, ws, ctx);
        await handleGroups(data, ws, ctx);
        await handleReactions(data, ws, ctx);
        await handleThreads(data, ws, ctx);
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
                const disconnectedPhone = ws.phone;
                const disconnectedUsername = ws.username;
                User.updateOne({ phone: disconnectedPhone }, { lastSeen: lastSeenNow }).exec().catch(e => console.error('[lastSeen] update error:', e.message));
                // Notificar lastSeen solo a quienes tienen a este usuario en contactos (o al admin)
                broadcastInfoFiltered(
                    { type: 'user_last_seen', username: disconnectedUsername, lastSeen: lastSeenNow.toISOString() },
                    disconnectedPhone
                ).catch(e => console.error("[broadcastInfoFiltered]", e.message));
            }
            broadcastUsers().catch(e => console.error("[broadcastUsers]", e.message));
            broadcastInfoFiltered({
                type:    'info',
                message: `${ws.username} salió del chat`
            }, ws.phone).catch(e => console.error("[broadcastInfoFiltered]", e.message));
        }
    });

    ws.on('error', (err) => {
        console.error(`Error WebSocket (${ws.username || 'sin-identificar'}):`, err.message);
    });
});



/* ============================================================
   HELPERS — sendMessage, broadcastUsers, broadcastToConversation
============================================================ */

/* ──────────────────────────────────────
   HELPERS
────────────────────────────────────── */
function sendMessage(message) {
    const base = { type: 'message', ...message._doc };

    // Payload para el REMITENTE — con isEcho:true para que el cliente sepa
    // que es confirmación de su propio mensaje (nunca debe mostrarlo como nuevo)
    const echoPayload  = JSON.stringify({ ...base, isEcho: true });
    // Payload para el DESTINATARIO — isEcho:false (es un mensaje recibido)
    const inboxPayload = JSON.stringify({ ...base, isEcho: false });

    // Enviar eco al remitente
    const senderWs = users.get(message.from);
    if (senderWs && senderWs.readyState === WebSocket.OPEN) {
        senderWs.send(echoPayload);
    }

    // Enviar al destinatario si está online
    const targetWs = users.get(message.to);
    if (targetWs && targetWs.readyState === WebSocket.OPEN && targetWs !== senderWs) {
        targetWs.send(inboxPayload);
        // Marcar como entregado
        Message.updateOne({ id: message.id }, { delivered: true }).exec().catch(e => console.error('[delivered] update error:', e.message));
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

async function broadcastUsers() {
    // Filtrar sockets que aún no han enviado 'join' (username vacío o nulo)
    const onlineWithAvatars = [...users.entries()]
        .filter(([name]) => name && typeof name === 'string' && name.trim() !== '')
        .map(([name, ws]) => ({
            username: name,
            avatar:   ws.avatar || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(name)}`,
            phone:    ws.phone || null,
            isAway:   ws.isAway || false
        }));

    // Enviar a cada usuario la lista filtrada por sus contactos.
    // El admin (ADMIN_PHONE) ve a todos; el resto solo ven a sus contactos.
    for (const [, ws] of users) {
        if (ws.readyState !== 1 /* OPEN */) continue;

        let listForThisUser;
        try {
            if (isAdmin(ws.phone)) {
                // El admin ve a todos excepto a sí mismo
                listForThisUser = onlineWithAvatars.filter(u => u.username !== ws.username);
            } else if (ws.phone) {
                // Usuario normal: obtener sus contactos de BD
                const myContacts = await Contact.find({ ownerPhone: ws.phone }).lean();
                const contactPhones = new Set(myContacts.map(c => c.contactPhone));
                // Solo incluir usuarios que estén en su lista de contactos (y no él mismo)
                listForThisUser = onlineWithAvatars.filter(u =>
                    u.username !== ws.username &&
                    u.phone &&
                    contactPhones.has(u.phone)
                );
            } else {
                // Sin teléfono: lista vacía (sesión legacy)
                listForThisUser = [];
            }
        } catch(_) {
            // En caso de error de BD, enviar lista vacía para no exponer datos
            listForThisUser = [];
        }

        try {
            ws.send(JSON.stringify({ type: 'users', online: listForThisUser }));
        } catch(_) {}
    }
}

function broadcast(data) {
    const payload = JSON.stringify(data);
    users.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(payload);
        }
    });
}

// Versión de broadcast para mensajes de tipo 'info' (entrada/salida de usuarios).
// Solo envía el aviso a quienes tienen al usuario afectado en sus contactos (o al admin).
// Para cualquier otro tipo de mensaje usa broadcast() directamente.
async function broadcastInfoFiltered(data, affectedPhone) {
    const payload = JSON.stringify(data);
    for (const [, ws] of users) {
        if (ws.readyState !== WebSocket.OPEN) continue;
        try {
            // El admin siempre recibe todos los avisos
            if (isAdmin(ws.phone)) {
                ws.send(payload);
                continue;
            }
            // Usuarios normales: solo si el usuario afectado está en sus contactos
            if (ws.phone && affectedPhone) {
                const contact = await Contact.findOne({ ownerPhone: ws.phone, contactPhone: affectedPhone }).lean();
                if (contact) ws.send(payload);
            }
        } catch(_) {}
    }
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
        // 1:1: enviar a from y to (ambos pueden estar online).
        // Usar un Set para evitar enviar dos veces si from === to.
        const targets = new Set([msgFrom, msgTo].filter(Boolean));
        targets.forEach(uname => {
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