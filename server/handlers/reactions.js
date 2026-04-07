'use strict';
/* ============================================================
   HANDLER: REACTIONS
   Reacciones, destacados, audio leído, autodestrucción, archivar
============================================================ */

module.exports = async function handle_reactions(data, ws, ctx) {
    const {
        users, userPhones, phoneSessions, pendingSessionRequests, pendingContactRequests,
        pendingUnread, Message, User, Contact, Group,
        crypto, webpush, cloudinary, subirImagenCloudinary,
        WebSocket,
        sendMessage, broadcastUsers, broadcastInfoFiltered,
        broadcastToConversation, enviarPushAPhone, enviarPushConConteo,
        resetearPendingUnread,
        isAdmin, ADMIN_PHONE,
    } = ctx;

    switch (data.type) {
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
    }
};
