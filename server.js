const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const crypto = require('crypto');
const mongoose = require('mongoose');
const Message = require('./models/Message');

mongoose.connect(
    'mongodb+srv://vmenendezmata_db_user:EZvyK3Na5uOUzJJY@cluster0.njpkfgg.mongodb.net/chat'
).then(() => console.log("MongoDB conectado"))
 .catch(err => console.error(err));

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static('public'));

server.listen(8080, () =>
    console.log("Servidor en http://localhost:8080")
);

const users = new Map();

wss.on('connection', (ws) => {

    ws.on('message', async (msg) => {

        const data = JSON.parse(msg);

        switch (data.type) {

            case 'join':

                ws.username = data.username;
                ws.avatar =
                    `https://api.dicebear.com/7.x/initials/svg?seed=${ws.username}`;

                users.set(ws.username, ws);

                broadcastUsers();

                // ❌ NO cargar historial aquí

                broadcast({
                    type: 'info',
                    message: `${ws.username} se ha unido al chat`
                });

                break;

            case 'message':{
                            
                const usersSorted = [ws.username, data.to].sort();
                const conversationId = usersSorted.join("_");

                const id = crypto.randomUUID();

                const message = new Message({
                    id,
                    conversationId,
                    from: ws.username,
                    to: data.to,
                    message: data.message,
                    delivered: false,
                    read: false
                });

                await message.save();
                sendMessage(message);

                break;
            }
            case 'typing':
                if (!data.to) break;

                users.forEach((client, username) => {

                    if (username === data.to) {

                        client.send(JSON.stringify({
                            type: 'typing',
                            username: ws.username,
                            status: data.status || "start"
                        }));

                    }

                });

                break;
            case 'loadConversation':{

                const usersSorted = [ws.username, data.with].sort();
                const conversationId = usersSorted.join("_");
                const history = await Message.find({
                    conversationId
                }).sort({ time: 1 });

                ws.send(JSON.stringify({
                    type: 'history',
                    messages: history
                }));

                break;
            }

            case 'history':


            case 'read':

                await Message.updateOne(
                    { id: data.id },
                    { read: true }
                );

                broadcast({
                    type: 'read',
                    id: data.id
                });

                break;
        }
    });

    ws.on('close', () => {

        users.delete(ws.username);
        broadcastUsers();

        broadcast({
            type: 'info',
            message: `${ws.username} salió del chat`
        });
    });
});

function sendMessage(message) {

    users.forEach((client, username) => {

        if (
            username === message.from ||
            username === message.to
        ) {

            client.send(JSON.stringify({
                type: 'message',
                ...message._doc
            }));
        }
    });

    // marcar como entregado
    if (users.has(message.to)) {
        Message.updateOne(
            { id: message.id },
            { delivered: true }
        ).exec();

        broadcast({
            type: 'delivered',
            id: message.id
        });
    }
}

function broadcastUsers() {
    broadcast({
        type: 'users',
        online: [...users.keys()]
    });
}

function broadcast(data) {
    users.forEach(ws => {
        ws.send(JSON.stringify(data));
    });
}
