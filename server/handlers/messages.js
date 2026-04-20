'use strict';
/* ============================================================
   HANDLER: MESSAGES
   Mensajes — enviar, cargar, editar, borrar, responder, reenviar
============================================================ */

const { broadcastBotResponse } = require('./bot');

module.exports = async function handle_messages(data, ws, ctx) {
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
                // Cachear el resultado para reutilizarlo en la comprobación de bloqueo
                let _cachedRecipientDoc = null;
                if (recipientUsername && !recipientPhone) {
                    _cachedRecipientDoc = await User.findOne({ username: recipientUsername }).lean();
                    if (_cachedRecipientDoc) recipientPhone = _cachedRecipientDoc.phone;
                }

                if (!recipientUsername) break; // destinatario desconocido

                // ── Comprobar bloqueo: si el destinatario ha bloqueado al remitente, descartar ──
                if (recipientPhone) {
                    // Reutilizar doc cacheado si ya lo tenemos; si no, buscarlo por phone
                    const recipientUserDoc = _cachedRecipientDoc
                        || await User.findOne({ phone: recipientPhone }).lean();
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
                        // Con lean() autoDestructSettings es un objeto plano (no Map),
                        // así que accedemos directamente con notación de corchetes.
                        const secs = senderUser && senderUser.autoDestructSettings
                            ? (senderUser.autoDestructSettings[conversationId] ?? null)
                            : null;
                        if (secs) expiresAt = new Date(Date.now() + secs * 1000);
                    } catch(_) {}
                }

                // ── Detectar comando /bot ANTES de guardar — el prompt nunca se almacena ni se emite ──
                const botPrefix = (data.message || '').trimStart();
                const isBotPublic = botPrefix.startsWith('/bot! ');
                const isBotCmd    = isBotPublic || botPrefix.startsWith('/bot ');
                if (isBotCmd && !imageData && !audioData) {
                    const botQuery = botPrefix.slice(isBotPublic ? 6 : 5).trim();
                    if (botQuery) {
                        broadcastBotResponse({
                            query:          botQuery,
                            askedBy:        ws.username,
                            conversationId,
                            toUsername:     recipientUsername,
                            groupId:        null,
                            grpMembers:     null,
                            isPublic:       isBotPublic,
                            ctx
                        }).catch(e => console.error('[Bot 1:1]', e.message));
                    }
                    break; // no guardar, no broadcast del comando
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
                // threadId != null → son respuestas de hilo, NO del chat principal
                const filter = { conversationId, threadId: null };
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
                try {
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
                } catch(e) { console.error('read error:', e.message); }
                break;
            }

            /* ──────────────────────────────────────
               WEBRTC: OFFER
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
                        if (!grp) {
                            // Revertir: borrar el mensaje guardado (grupo no encontrado)
                            try { await Message.deleteOne({ id: newId }); } catch(_) {}
                            break;
                        }
                        // Comprobar que el remitente es miembro del grupo
                        if (!grp.members.includes(ws.phone)) {
                            // Revertir: borrar el mensaje guardado (no es miembro)
                            try { await Message.deleteOne({ id: newId }); } catch(_) {}
                            break;
                        }
                        const gmPayload = JSON.stringify({ type: 'groupMessage', ...fwdMsg._doc, groupId, groupName: grp.name });
                        const fwdPreviewText = fwdMsg.imageData ? '📷 Imagen'
                            : fwdMsg.audioData ? '🎙️ Audio'
                            : (fwdMsg.message || '').slice(0, 80);
                        grp.members.forEach(mp => {
                            const mws = [...users.values()].find(u => u.phone === mp);
                            if (mws && mws.readyState === WebSocket.OPEN) {
                                mws.send(gmPayload);
                                if (mws.isAway && mp !== ws.phone) {
                                    enviarPushConConteo(mp, 'group_' + groupId, {
                                        title: `👥 ${grp.name}`,
                                        body:  `${ws.username}: ${fwdPreviewText || '…'}`,
                                        icon:  '/icon-192.png', badge: '/icon-192.png',
                                        tag:   'grp_' + groupId, renotify: true,
                                        data:  { groupId, chatKey: 'group_' + groupId }
                                    });
                                }
                            } else if (mp !== ws.phone) {
                                enviarPushConConteo(mp, 'group_' + groupId, {
                                    title: `👥 ${grp.name}`,
                                    body:  `${ws.username}: ${fwdPreviewText || '…'}`,
                                    icon:  '/icon-192.png', badge: '/icon-192.png',
                                    tag:   'grp_' + groupId, renotify: true,
                                    data:  { groupId, chatKey: 'group_' + groupId }
                                });
                            }
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
                        if (!grp || !grp.members.includes(ws.phone)) {
                            // Revertir: borrar el mensaje guardado (el usuario no es miembro del grupo)
                            try { await Message.deleteOne({ id: newId }); } catch(_) {}
                            break;
                        }
                        const gmPayload = JSON.stringify({ type: 'groupMessage', ...replyMsg._doc, groupId, groupName: grp.name });
                        const replyPreviewText = replyMsg.imageData ? '📷 Imagen'
                            : replyMsg.audioData ? '🎙️ Audio'
                            : (replyMsg.message || '').slice(0, 80);
                        grp.members.forEach(mp => {
                            const mws = [...users.values()].find(u => u.phone === mp);
                            if (mws && mws.readyState === WebSocket.OPEN) {
                                mws.send(gmPayload);
                                // Push si está en background y no es el remitente
                                if (mws.isAway && mp !== ws.phone) {
                                    enviarPushConConteo(mp, 'group_' + groupId, {
                                        title: `👥 ${grp.name}`,
                                        body:  `${ws.username}: ${replyPreviewText || '…'}`,
                                        icon:  '/icon-192.png',
                                        badge: '/icon-192.png',
                                        tag:   'grp_' + groupId,
                                        renotify: true,
                                        data:  { groupId, chatKey: 'group_' + groupId }
                                    });
                                }
                            } else if (mp !== ws.phone) {
                                // Offline: push con conteo
                                enviarPushConConteo(mp, 'group_' + groupId, {
                                    title: `👥 ${grp.name}`,
                                    body:  `${ws.username}: ${replyPreviewText || '…'}`,
                                    icon:  '/icon-192.png',
                                    badge: '/icon-192.png',
                                    tag:   'grp_' + groupId,
                                    renotify: true,
                                    data:  { groupId, chatKey: 'group_' + groupId }
                                });
                            }
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
    }
};
