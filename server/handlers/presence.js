'use strict';
/* ============================================================
   HANDLER: PRESENCE
   Presencia — ping, typing, recording, set_presence, avatar
============================================================ */

module.exports = async function handle_presence(data, ws, ctx) {
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
            case 'kvs_ping': {
                ws.lastPing = Date.now();
                ws.isAlive  = true;
                if (ws.isAway) {
                    ws.isAway = false;
                    broadcastUsers().catch(e => console.error("[broadcastUsers]", e.message)); // avisar a todos que volvió
                }
                // Responder con pong para que el cliente sepa que el servidor está vivo
                try { ws.send(JSON.stringify({ type: 'kvs_pong' })); } catch(_) {}
                break;
            }

            /* ──────────────────────────────────────
               MARK READ: el cliente abrió un chat concreto.
               1. Resetea el contador de no leídos push.
               2. Marca como leídos en BD todos los mensajes
                  no leídos de esa conversación dirigidos a
                  este usuario.
               3. Notifica a los remitentes (flechitas azules).
               Mensaje: { type: 'markRead', chatKey: 'username' | 'group_XXX' }
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
               GRABANDO AUDIO (1:1)
               Mismo mecanismo que typing pero para
               indicar que el usuario está grabando
               un mensaje de voz.
            ────────────────────────────────────── */

            case 'recording': {
                if (!data.to) break;
                const recTarget = users.get(data.to);
                if (recTarget && recTarget.readyState === WebSocket.OPEN) {
                    recTarget.send(JSON.stringify({
                        type:     'recording',
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

            case 'set_presence': {
                if (!ws.username) break;
                ws.isAway = (data.status === 'away');
                if (data.status === 'away') {
                    // No reseteamos lastPing en away — el timer de APP_PING lo gestiona
                } else {
                    ws.lastPing = Date.now(); // volvió al foreground → resetear timer
                }
                broadcastUsers().catch(e => console.error("[broadcastUsers]", e.message));
                break;
            }

            /* ──────────────────────────────────────
               SOLICITUD DE CONTACTO
               El remitente la envía; si el destinatario
               está online la recibe al momento, si no
               queda pendiente para cuando se conecte.
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
               ACTUALIZAR AVATAR DE GRUPO (cualquier miembro)
            ────────────────────────────────────── */

            case 'updateGroupAvatar': {
                if (!data.groupId || !data.avatar) break;
                if (!ws.phone) break;
                if (!/^data:image\//.test(data.avatar)) break;
                try {
                    const grp = await Group.findOne({ groupId: data.groupId });
                    if (!grp || !grp.members.includes(ws.phone)) break;
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
    }
};
