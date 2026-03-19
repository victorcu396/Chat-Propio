const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

require('dotenv').config(); 
const express = require('express');

const WebSocket = require('ws');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const mongoose = require('mongoose');

const Message = require('./models/Message');
const User = require('./models/User');
const Contact = require('./models/Contact');
const Group = require('./models/Group');

const app = express();
const server = http.createServer(app);

const mongoURI = process.env.MONGODB_URI;
const port = process.env.PORT || 8080;

mongoose.connect(mongoURI)
    .then(() => console.log("MongoDB conectado"))
    .catch(err => console.error("MongoDB error:", err));

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
        res.json({ phone: user.phone, username: user.username, avatar: user.avatar });
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

server.listen(port, () =>
    console.log(`🚀 Servidor corriendo en http://localhost:${port}`)
);

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

        switch (data.type) {

            /* ──────────────────────────────────────
               JOIN (con teléfono)
            ────────────────────────────────────── */
            case 'join': {
                ws.username = data.username;
                ws.phone    = data.phone || null;

                // ── Sesión única por número de teléfono ──────────────────
                // Si ya hay otra sesión activa con el mismo teléfono, la cerramos.
                if (ws.phone) {
                    const existingWs = phoneSessions.get(ws.phone);
                    if (existingWs && existingWs !== ws && existingWs.readyState === 1 /* OPEN */) {
                        try {
                            existingWs.send(JSON.stringify({
                                type: 'session_kicked',
                                message: 'Tu sesión fue iniciada en otro dispositivo o pestaña.'
                            }));
                        } catch(_) {}
                        existingWs.close(4001, 'session_replaced');
                    }
                    phoneSessions.set(ws.phone, ws);
                }
                // ─────────────────────────────────────────────────────────

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

                // Validar imagen base64 si viene
                let imageData = null;
                if (data.imageData) {
                    if (/^data:image\/(png|jpeg|jpg|gif|webp);base64,/.test(data.imageData)) {
                        imageData = data.imageData;
                    }
                }

                // Validar audio base64 si viene
                let audioData = null;
                if (data.audioData) {
                    if (/^data:audio\/[a-zA-Z0-9]+/.test(data.audioData)) {
                        audioData = data.audioData;
                    }
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
                    read:      false
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

                const history = await Message.find({ conversationId })
                    .sort({ time: 1 });

                ws.send(JSON.stringify({
                    type:     'history',
                    messages: history,
                    withUsername  // devolver el username resuelto al cliente
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
                    const senderWs = users.get(msg.from);
                    if (senderWs) {
                        senderWs.send(JSON.stringify({
                            type: 'read',
                            id:   data.id
                        }));
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
               ACTUALIZAR AVATAR DE GRUPO (solo admin)
            ────────────────────────────────────── */
            case 'updateGroupAvatar': {
                if (!data.groupId || !data.avatar) break;
                if (!ws.phone) break;
                if (!/^data:image\//.test(data.avatar)) break;
                try {
                    const grp = await Group.findOne({ groupId: data.groupId });
                    if (!grp || grp.ownerPhone !== ws.phone) break;
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
                    imageData = data.imageData;
                }
                let audioData = null;
                if (data.audioData && /^data:audio\/[a-zA-Z0-9]+/.test(data.audioData)) {
                    audioData = data.audioData;
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
                    read:           false
                });
                await gmMessage.save();

                const gmPayload = JSON.stringify({
                    type:      'groupMessage',
                    ...gmMessage._doc,
                    groupId:   data.groupId,
                    groupName: grpMsg.name
                });
                grpMsg.members.forEach(memberPhone => {
                    const memberWs = [...users.values()].find(u => u.phone === memberPhone);
                    if (memberWs && memberWs.readyState === WebSocket.OPEN) {
                        memberWs.send(gmPayload);
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

                const grpHistory = await Message.find({ conversationId: 'group_' + data.groupId })
                    .sort({ time: 1 });

                ws.send(JSON.stringify({
                    type:     'groupHistory',
                    groupId:  data.groupId,
                    messages: grpHistory
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
                    if (grp.ownerPhone !== ws.phone) { ws.send(JSON.stringify({ type: 'groupError', message: 'Solo el administrador puede editar el grupo.' })); break; }

                    const oldMembers = [...grp.members];

                    if (data.name && data.name.trim()) grp.name = data.name.trim();

                    if (Array.isArray(data.memberPhones)) {
                        grp.members = [...new Set([ws.phone, ...data.memberPhones])];
                    }

                    await grp.save();

                    const updatedPayload = { type: 'groupUpdated', groupId: grp.groupId, name: grp.name, ownerPhone: grp.ownerPhone, members: grp.members };
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
                    if (!msg || msg.from !== ws.username) break;
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
                    if (data.imageData && /^data:image\/(png|jpeg|jpg|gif|webp);base64,/.test(data.imageData)) imageData = data.imageData;

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
    }
    // Si offline: el mensaje queda en BD con delivered:false y se entrega al reconectar
}

function broadcastUsers() {
    const onlineWithAvatars = [...users.entries()].map(([name, ws]) => ({
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