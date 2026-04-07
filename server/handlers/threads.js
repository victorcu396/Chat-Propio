'use strict';
/* ============================================================
   HANDLER: THREADS
   Hilos — enviar mensaje de hilo, cargar historial
============================================================ */

module.exports = async function handle_threads(data, ws, ctx) {
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
            case 'threadMessage': {
                if (!data.threadId || !data.message) break;
                try {
                    const root = await Message.findOne({ id: data.threadId });
                    if (!root || root.deletedAt) break;

                    const isGroup = root.conversationId && root.conversationId.startsWith('group_');
                    let tGrp = null;

                    // Verificar que el usuario tiene acceso a esta conversación
                    if (isGroup) {
                        const tGrpId = root.conversationId.replace('group_', '');
                        tGrp = await Group.findOne({ groupId: tGrpId }).lean();
                        if (!tGrp || !tGrp.members.includes(ws.phone)) break;
                    } else {
                        // 1:1: verificar que el usuario es participante.
                        // Comparamos directamente con from/to del mensaje raíz,
                        // sin depender del formato del conversationId.
                        const isParticipant =
                            root.from === ws.username ||
                            root.to   === ws.username;
                        if (!isParticipant) break;
                    }

                    const newId = crypto.randomUUID();

                    // En 1:1, el 'to' del hilo es el otro participante de la conversación.
                    // Usamos root.from y root.to directamente — son los usernames reales
                    // y nunca dependen del formato del conversationId (que usa _ como separador
                    // y fallaría si los usernames contienen _).
                    let threadTo = root.to;
                    if (!isGroup) {
                        // El otro participante es quien no somos nosotros
                        if (root.from === ws.username) {
                            threadTo = root.to;
                        } else {
                            threadTo = root.from;
                        }
                    }

                    const threadMsg = new Message({
                        id:             newId,
                        conversationId: root.conversationId,
                        from:           ws.username,
                        to:             threadTo,
                        message:        data.message,
                        avatar:         ws.avatar,
                        threadId:       data.threadId,
                        delivered:      true,
                        read:           false
                    });
                    await threadMsg.save();

                    root.threadCount = (root.threadCount || 0) + 1;
                    await root.save();

                    const payload = JSON.stringify({
                        type:        'thread_message',
                        msg:         threadMsg._doc,
                        threadId:    data.threadId,
                        threadCount: root.threadCount
                    });

                    if (isGroup && tGrp) {
                        // Grupo: enviar a todos los miembros online
                        tGrp.members.forEach(memberPhone => {
                            const memberWs = [...users.values()].find(u => u.phone === memberPhone);
                            if (memberWs && memberWs.readyState === WebSocket.OPEN) {
                                try { memberWs.send(payload); } catch(_) {}
                            }
                        });
                    } else {
                        // 1:1: enviar a ambos participantes.
                        // Usamos root.from y threadTo (calculado más arriba) que son los
                        // usernames reales de los dos participantes, independientemente
                        // de cuántos '_' tengan sus nombres.
                        const participantes = new Set([root.from, threadTo, ws.username].filter(Boolean));
                        participantes.forEach(uname => {
                            const uWs = users.get(uname);
                            if (uWs && uWs.readyState === WebSocket.OPEN) {
                                try { uWs.send(payload); } catch(_) {}
                            }
                        });
                    }
                } catch(e) { console.error('threadMessage error:', e.message); }
                break;
            }

            /* ──────────────────────────────────────
               CARGAR HILO
            ────────────────────────────────────── */

            case 'loadThread': {
                if (!data.threadId) break;
                try {
                    const rootMsg = await Message.findOne({ id: data.threadId }).lean();
                    const replies = await Message.find({ threadId: data.threadId }).sort({ time: 1 }).lean();
                    ws.send(JSON.stringify({
                        type:     'thread_history',
                        threadId: data.threadId,
                        messages: replies,
                        rootMsg:  rootMsg || null
                    }));
                } catch(e) { console.error('loadThread error:', e.message); }
                break;
            }

            /* ──────────────────────────────────────
               BORRAR CONVERSACIÓN COMPLETA
               Borra suavemente todos los mensajes de
               una conversación para el usuario que lo pide.
            ────────────────────────────────────── */
    }
};
