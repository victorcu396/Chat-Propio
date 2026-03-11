require('dotenv').config(); 
const express = require('express');

const WebSocket = require('ws');
const http = require('http');
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

        res.json(enriched);
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

// IMPORTANTE PORT=8080
server.listen(port, () =>
    console.log(`🚀 Servidor corriendo en http://localhost:${port}`)
);

// Map: username → WebSocket
const users = new Map();

// Map: username → phone (para info de usuario)
const userPhones = new Map();

// Map: phone → WebSocket  (para control de sesión única por número)
const phoneSessions = new Map();

wss.on('connection', (ws) => {

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
                break;
            }

            /* ──────────────────────────────────────
               MESSAGE (texto + imagen opcional)
            ────────────────────────────────────── */
            case 'message': {
                if (!data.to) break;

                const usersSorted    = [ws.username, data.to].sort();
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
                    // Acepta variantes reales: audio/webm;codecs=opus, audio/ogg;codecs=opus, etc.
                    if (/^data:audio\/[a-zA-Z0-9]+/.test(data.audioData)) {
                        audioData = data.audioData;
                    }
                }

                const message = new Message({
                    id,
                    conversationId,
                    from:      ws.username,
                    to:        data.to,
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
            ────────────────────────────────────── */
            case 'loadConversation': {
                if (!data.with) break;

                const usersSorted    = [ws.username, data.with].sort();
                const conversationId = usersSorted.join('_');

                const history = await Message.find({ conversationId })
                    .sort({ time: 1 });

                ws.send(JSON.stringify({
                    type:     'history',
                    messages: history
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
                const target = users.get(data.to);
                if (target && target.readyState === WebSocket.OPEN) {
                    target.send(JSON.stringify({
                        type: 'call_offer',
                        from: ws.username,
                        sdp:  data.sdp
                    }));
                } else {
                    // Destinatario offline
                    ws.send(JSON.stringify({
                        type: 'info',
                        message: `${data.to} no está disponible para llamadas ahora mismo.`
                    }));
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
                // Actualizar en MongoDB
                if (ws.phone) {
                    User.updateOne({ phone: ws.phone }, { avatar: ws.avatar }).exec();
                }
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
               ELIMINAR CONTACTO
            ────────────────────────────────────── */
            case 'removeContact': {
                if (!data.contactPhone) break;
                if (!ws.phone) break;

                try {
                    await Contact.deleteOne({ ownerPhone: ws.phone, contactPhone: data.contactPhone });
                    ws.send(JSON.stringify({
                        type: 'contactRemoved',
                        contactPhone: data.contactPhone
                    }));
                } catch(e) {
                    console.error('removeContact error:', e.message);
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

    users.forEach((client, username) => {
        if (username === message.from || username === message.to) {
            if (client.readyState === WebSocket.OPEN) {
                client.send(payload);
            }
        }
    });

    // Marcar como entregado si el destinatario está online
    if (users.has(message.to)) {
        Message.updateOne(
            { id: message.id },
            { delivered: true }
        ).exec();

        const senderWs = users.get(message.from);
        if (senderWs && senderWs.readyState === WebSocket.OPEN) {
            senderWs.send(JSON.stringify({
                type: 'delivered',
                id:   message.id
            }));
        }
    }
}

function broadcastUsers() {
    const onlineWithAvatars = [...users.entries()].map(([name, ws]) => ({
        username: name,
        avatar:   ws.avatar || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(name)}`,
        phone:    ws.phone || null
    }));
    broadcast({
        type:   'users',
        online: onlineWithAvatars
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