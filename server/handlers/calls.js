'use strict';
/* ============================================================
   HANDLER: CALLS
   Llamadas WebRTC — 1:1 y grupales
============================================================ */

module.exports = async function handle_calls(data, ws, ctx) {
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
    }
};
