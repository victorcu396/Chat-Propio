'use strict';
/* ============================================================
   HANDLER: AUTH
   Autenticación — join, session_auth_response
============================================================ */

module.exports = async function handle_auth(data, ws, ctx) {
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

                // Restaurar avatar: primero intenta el que manda el cliente (base64),
                // luego el guardado en BD, y por último el dicebear por defecto.
                const defaultAvatar = `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(ws.username)}`;
                if (data.avatar && /^data:image\//.test(data.avatar)) {
                    ws.avatar = data.avatar;
                } else {
                    // Intentar recuperar avatar de BD (puede ser URL Cloudinary)
                    if (ws.phone) {
                        try {
                            const savedUser = await User.findOne({ phone: ws.phone }).lean();
                            ws.avatar = (savedUser && savedUser.avatar) ? savedUser.avatar : defaultAvatar;
                        } catch(_) {
                            ws.avatar = defaultAvatar;
                        }
                    } else {
                        ws.avatar = defaultAvatar;
                    }
                }

                users.set(ws.username, ws);
                if (ws.phone) userPhones.set(ws.username, ws.phone);

                // Upsert usuario en MongoDB (solo si hay phone válido)
                if (ws.phone) {
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
                        console.error('join upsert error:', e.message);
                    }
                }

                broadcastUsers().catch(e => console.error("[broadcastUsers]", e.message));

                broadcastInfoFiltered({
                    type: 'info',
                    message: `${ws.username} se ha unido al chat`
                }, ws.phone).catch(e => console.error("[broadcastInfoFiltered]", e.message));

                // ── Entregar mensajes pendientes (enviados mientras estaba offline) ──
                try {
                    const pending = await Message.find({
                        to:        ws.username,
                        delivered: false,
                        threadId:  null   // no entregar mensajes de hilo como pendientes
                    }).sort({ time: 1 });

                    for (const msg of pending) {
                        // Enviar al destinatario (ahora online) — isEcho:false = mensaje recibido
                        ws.send(JSON.stringify({ type: 'message', ...msg._doc, isEcho: false }));
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
                    // Intentar recuperar avatar de BD (puede ser URL Cloudinary)
                    if (phone) {
                        try {
                            const savedUser2 = await User.findOne({ phone }).lean();
                            newWs.avatar = (savedUser2 && savedUser2.avatar) ? savedUser2.avatar : defaultAvatar;
                        } catch(_) {
                            newWs.avatar = defaultAvatar;
                        }
                    } else {
                        newWs.avatar = defaultAvatar;
                    }
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

                broadcastUsers().catch(e => console.error("[broadcastUsers]", e.message));
                broadcastInfoFiltered({ type: 'info', message: `${newUsername} se ha unido al chat` }, phone).catch(e => console.error("[broadcastInfoFiltered]", e.message));

                // Entregar mensajes pendientes al nuevo dispositivo
                try {
                    const pendingMsgs = await Message.find({ to: newUsername, delivered: false, threadId: null }).sort({ time: 1 });
                    for (const msg of pendingMsgs) {
                        newWs.send(JSON.stringify({ type: 'message', ...msg._doc, isEcho: false }));
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
    }
};
