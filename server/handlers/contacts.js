'use strict';
/* ============================================================
   HANDLER: CONTACTS
   Contactos — agregar, bloquear, solicitudes, renombrar
============================================================ */

module.exports = async function handle_contacts(data, ws, ctx) {
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
                            // Actualizar lista de conectados para ambos ahora que son contactos
                            broadcastUsers().catch(e => console.error("[broadcastUsers]", e.message));
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
                        // Actualizar lista de conectados para ambos ahora que son contactos
                        broadcastUsers().catch(e => console.error("[broadcastUsers]", e.message));
                    }
                } catch(e) {
                    console.error('respondContactRequest error:', e.message);
                }
                break;
            }

            /* ──────────────────────────────────────
               EDITAR MENSAJE
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
};
