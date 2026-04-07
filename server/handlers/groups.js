'use strict';
/* ============================================================
   HANDLER: GROUPS
   Grupos — mensajes, historial, crear, editar, borrar
============================================================ */

module.exports = async function handle_groups(data, ws, ctx) {
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
            case 'groupMessage': {
                if (!data.groupId || (!data.message && !data.imageData && !data.audioData)) break;

                const grpMsg = await Group.findOne({ groupId: data.groupId });
                if (!grpMsg) break;
                if (!grpMsg.members.includes(ws.phone)) break;

                let imageData = null;
                if (data.imageData && /^data:image\/(png|jpeg|jpg|gif|webp);base64,/.test(data.imageData)) {
                    if (cloudinary) {
                        const url = await subirImagenCloudinary(data.imageData);
                        imageData = url || data.imageData;
                    } else {
                        imageData = data.imageData;
                    }
                }
                let audioData = null;
                if (data.audioData && /^data:audio\/[a-zA-Z0-9]+/.test(data.audioData)) {
                    audioData = data.audioData;
                }

                // Extraer menciones del texto del mensaje de grupo
                const gmMentionMatches = (data.message || '').match(/@([^\s<>&"']+)/g) || [];
                let gmMentions = gmMentionMatches.map(m => m.slice(1));
                // Si hay @todos, expandir a todos los miembros del grupo
                if (gmMentions.includes('todos') || gmMentions.includes('all')) {
                    const allMemberUsernames = grpMsg.members
                        .map(phone => {
                            const u = [...users.values()].find(u => u.phone === phone);
                            return u ? u.username : null;
                        })
                        .filter(Boolean);
                    // Reemplazar @todos por la lista real + mantener otras menciones
                    gmMentions = [...new Set([
                        ...gmMentions.filter(m => m !== 'todos' && m !== 'all'),
                        ...allMemberUsernames
                    ])];
                }

                const gmId = crypto.randomUUID();
                // Calcular expiresAt para autodestrucción en grupos
                let gmExpiresAt = null;
                if (ws.phone) {
                    try {
                        const gmSenderUser = await User.findOne({ phone: ws.phone }).lean();
                        const gmConvId = 'group_' + data.groupId;
                        const gmSecs = gmSenderUser && gmSenderUser.autoDestructSettings
                            ? (gmSenderUser.autoDestructSettings[gmConvId] ?? null)
                            : null;
                        if (gmSecs) gmExpiresAt = new Date(Date.now() + gmSecs * 1000);
                    } catch(_) {}
                }

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
                    read:           false,
                    mentions:       gmMentions,
                    expiresAt:      gmExpiresAt
                });
                await gmMessage.save();

                const gmPayload = JSON.stringify({
                    type:      'groupMessage',
                    ...gmMessage._doc,
                    groupId:   data.groupId,
                    groupName: grpMsg.name
                });
                const grpPreviewText = gmMessage.imageData ? '📷 Imagen'
                    : gmMessage.audioData ? '🎙️ Audio'
                    : (gmMessage.message || '').slice(0, 80);

                grpMsg.members.forEach(memberPhone => {
                    const memberWs = [...users.values()].find(u => u.phone === memberPhone);
                    if (memberWs && memberWs.readyState === WebSocket.OPEN) {
                        memberWs.send(gmPayload);
                        // Si está en background (y no es el remitente), también push con conteo
                        if (memberWs.isAway && memberPhone !== ws.phone) {
                            enviarPushConConteo(memberPhone, 'group_' + data.groupId, {
                                title: `👥 ${grpMsg.name}`,
                                body:  `${ws.username}: ${grpPreviewText || '…'}`,
                                icon:  '/icon-192.png',
                                badge: '/icon-192.png',
                                tag:   'grp_' + data.groupId,
                                renotify: true,
                                data:  { groupId: data.groupId, chatKey: 'group_' + data.groupId }
                            });
                        }
                    } else if (memberPhone !== ws.phone) {
                        // Offline (y no es el remitente): enviar push con conteo
                        enviarPushConConteo(memberPhone, 'group_' + data.groupId, {
                            title: `👥 ${grpMsg.name}`,
                            body:  `${ws.username}: ${grpPreviewText || '…'}`,
                            icon:  '/icon-192.png',
                            badge: '/icon-192.png',
                            tag:   'grp_' + data.groupId,
                            renotify: true,
                            data:  { groupId: data.groupId, chatKey: 'group_' + data.groupId }
                        });
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

                const PAGE_SIZE = 50;
                // threadId != null → son respuestas de hilo, NO del chat principal
                const grpFilter = { conversationId: 'group_' + data.groupId, threadId: null };
                if (data.beforeId) {
                    const anchor = await Message.findOne({ id: data.beforeId }).lean();
                    if (anchor) grpFilter.time = { $lt: anchor.time };
                }
                const grpHistory = await Message.find(grpFilter)
                    .sort({ time: -1 })
                    .limit(PAGE_SIZE)
                    .lean();
                grpHistory.reverse();

                ws.send(JSON.stringify({
                    type:       'groupHistory',
                    groupId:    data.groupId,
                    messages:   grpHistory,
                    hasMore:    grpHistory.length === PAGE_SIZE,
                    isLoadMore: !!data.beforeId
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
               EDITAR GRUPO (renombrar + cambiar miembros)
               Solo el admin/creador puede hacerlo
            ────────────────────────────────────── */

            case 'editGroup': {
                if (!data.groupId) break;
                if (!ws.phone) break;
                try {
                    const grp = await Group.findOne({ groupId: data.groupId });
                    if (!grp) { ws.send(JSON.stringify({ type: 'groupError', message: 'Grupo no encontrado.' })); break; }
                    // Cualquier miembro puede editar nombre y foto
                    if (!grp.members.includes(ws.phone)) { ws.send(JSON.stringify({ type: 'groupError', message: 'No eres miembro de este grupo.' })); break; }

                    const oldMembers = [...grp.members];

                    if (data.name && data.name.trim()) grp.name = data.name.trim();

                    // Solo el admin puede añadir o quitar miembros
                    if (Array.isArray(data.memberPhones) && grp.ownerPhone === ws.phone) {
                        grp.members = [...new Set([ws.phone, ...data.memberPhones])];
                    }

                    await grp.save();

                    const updatedPayload = { type: 'groupUpdated', groupId: grp.groupId, name: grp.name, ownerPhone: grp.ownerPhone, members: grp.members, avatar: grp.avatar || null };
                    const allAffected = [...new Set([...oldMembers, ...grp.members])];

                    allAffected.forEach(memberPhone => {
                        const memberWs = [...users.values()].find(u => u.phone === memberPhone);
                        if (memberWs && memberWs.readyState === WebSocket.OPEN) {
                            if (!grp.members.includes(memberPhone)) {
                                memberWs.send(JSON.stringify({ type: 'groupLeft', groupId: grp.groupId }));
                            } else {
                                memberWs.send(JSON.stringify(updatedPayload));
                            }
                        }
                    });
                } catch(e) {
                    console.error('editGroup error:', e.message);
                    ws.send(JSON.stringify({ type: 'groupError', message: e.message }));
                }
                break;
            }

            /* ──────────────────────────────────────
               PING de aplicación (JS-level)
               El cliente lo envía cada 15s mientras
               la app está activa en primer plano.
               Actualiza lastPing y limpia isAway.
            ────────────────────────────────────── */
    }
};
