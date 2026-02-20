const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const crypto = require('crypto');
const mongoose = require('mongoose');
const Message = require('./models/Message');

mongoose.connect(
    'mongodb+srv://vmenendezmata_db_user:EZvyK3Na5uOUzJJY@cluster0.njpkfgg.mongodb.net/chat'
).then(() => console.log("MongoDB conectado"))
 .catch(err => console.error("MongoDB error:", err));

const app = express();
const server = http.createServer(app);

// Aumentar límite para base64 de imágenes (hasta ~5 MB por imagen)
const wss = new WebSocket.Server({ server, maxPayload: 10 * 1024 * 1024 });

app.use(express.static('public'));

server.listen(8080, () =>
    console.log("Servidor en http://localhost:8080")
);

const users = new Map();

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
               JOIN
            ────────────────────────────────────── */
            case 'join': {
                ws.username = data.username;
                ws.avatar   = `https://api.dicebear.com/7.x/initials/svg?seed=${ws.username}`;

                users.set(ws.username, ws);
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
                    // Aceptar solo imágenes base64 válidas
                    if (/^data:image\/(png|jpeg|jpg|gif|webp);base64,/.test(data.imageData)) {
                        imageData = data.imageData;
                    }
                }

                const message = new Message({
                    id,
                    conversationId,
                    from:      ws.username,
                    to:        data.to,
                    message:   data.message || '',
                    imageData,
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

                // Solo notificar al remitente original
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
        }
    });

    ws.on('close', () => {
        if (ws.username) {
            users.delete(ws.username);
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
    broadcast({
        type:   'users',
        online: [...users.keys()]
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