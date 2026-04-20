'use strict';
/* ============================================================
   HANDLER: BOT IA
   - Conoce la fecha y hora actual
   - Lee el historial de la conversación como contexto
   - Puede responder sobre los mensajes, resumir, etc.
============================================================ */

const HISTORY_LIMIT = 30; // mensajes de contexto que se pasan a Groq

function _buildSystemPrompt(conversationHistory, askedBy) {
    const now = new Date();
    const dateStr = now.toLocaleDateString('es-ES', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
    const timeStr = now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

    let prompt =
        `Eres un asistente IA integrado en kiVooSpace, una app de mensajería privada.\n` +
        `Fecha actual: ${dateStr}. Hora actual: ${timeStr}.\n` +
        `El usuario que te pregunta ahora se llama "${askedBy}".\n` +
        `Responde siempre en el mismo idioma de la pregunta. ` +
        `Sé directo: sin introducciones largas ni despedidas. ` +
        `Si la respuesta puede ser larga, usa listas o párrafos cortos para facilitar la lectura.`;

    if (conversationHistory && conversationHistory.length > 0) {
        const lines = conversationHistory.map(m => {
            if (m.deletedAt) return null;
            if (m.from === '__bot__') {
                return `🤖 Bot IA: ${m.message || ''}`;
            }
            if (m.imageData) return `${m.from}: [imagen adjunta]`;
            if (m.audioData) return `${m.from}: [audio adjunto]`;
            if (m.message)   return `${m.from}: ${m.message}`;
            return null;
        }).filter(Boolean);

        if (lines.length > 0) {
            prompt +=
                `\n\nHistorial reciente de la conversación (para que puedas hacer referencia a ` +
                `mensajes anteriores, resumirlos o responder preguntas sobre ellos):\n` +
                lines.join('\n');
        }
    }

    return prompt;
}

async function callGroq(query, conversationHistory, askedBy) {
    const systemPrompt = _buildSystemPrompt(conversationHistory, askedBy);

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
        },
        body: JSON.stringify({
            model:       'llama-3.1-8b-instant',
            messages:    [
                { role: 'system', content: systemPrompt },
                { role: 'user',   content: query }
            ],
            max_tokens:  1024,
            temperature: 0.7
        })
    });

    if (!response.ok) {
        const err = await response.text().catch(() => '');
        throw new Error(`Groq ${response.status}: ${err}`);
    }
    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || '(sin respuesta)';
}

/* ──────────────────────────────────────────────────────────────────────────
   broadcastBotResponse
   Carga historial, llama a Groq y emite bot_response a los participantes.
────────────────────────────────────────────────────────────────────────── */
async function broadcastBotResponse({ query, askedBy, conversationId, toUsername, groupId, grpMembers, ctx }) {
    const { Message, crypto, users, WebSocket } = ctx;

    if (!process.env.GROQ_API_KEY) {
        const errPayload = JSON.stringify({
            type:          'bot_response',
            id:            crypto.randomUUID(),
            conversationId,
            message:       '⚠️ El bot no está configurado. Añade GROQ_API_KEY al .env del servidor.',
            query,
            askedBy,
            groupId:       groupId || undefined,
            time:          new Date()
        });
        _emitToParticipants(errPayload, conversationId, toUsername, askedBy, groupId, grpMembers, users, WebSocket);
        return;
    }

    // Cargar historial reciente para dar contexto al modelo
    let conversationHistory = [];
    try {
        const recentMsgs = await Message.find({
            conversationId,
            threadId: null,
            deletedAt: null
        })
        .sort({ time: -1 })
        .limit(HISTORY_LIMIT)
        .lean();
        conversationHistory = recentMsgs.reverse();
    } catch (e) {
        console.warn('[Bot] No se pudo obtener historial:', e.message);
    }

    let botText;
    try {
        botText = await callGroq(query, conversationHistory, askedBy);
    } catch (e) {
        console.error('[Bot] Error al llamar a Groq:', e.message);
        botText = '⚠️ El bot no pudo responder en este momento. Inténtalo de nuevo.';
    }

    const botId = crypto.randomUUID();
    try {
        const botMsg = new Message({
            id:             botId,
            conversationId,
            from:           '__bot__',
            to:             toUsername || groupId,
            message:        botText,
            avatar:         'https://api.dicebear.com/7.x/bottts/svg?seed=kiVooBot',
            delivered:      true,
            read:           false,
            isBot:          true,
            botQuery:       query,
            botAskedBy:     askedBy
        });
        await botMsg.save();
    } catch (e) {
        console.error('[Bot] Error al guardar en BD:', e.message);
    }

    const payload = JSON.stringify({
        type:          'bot_response',
        id:            botId,
        conversationId,
        message:       botText,
        query,
        askedBy,
        groupId:       groupId || undefined,
        time:          new Date()
    });

    _emitToParticipants(payload, conversationId, toUsername, askedBy, groupId, grpMembers, users, WebSocket);
}

function _emitToParticipants(payload, conversationId, toUsername, askedBy, groupId, grpMembers, users, WebSocket) {
    if (groupId && grpMembers) {
        grpMembers.forEach(memberPhone => {
            const mws = [...users.values()].find(u => u.phone === memberPhone);
            if (mws && mws.readyState === WebSocket.OPEN) {
                try { mws.send(payload); } catch (_) {}
            }
        });
    } else {
        const targets = new Set([askedBy, toUsername].filter(Boolean));
        targets.forEach(uname => {
            const uws = users.get(uname);
            if (uws && uws.readyState === WebSocket.OPEN) {
                try { uws.send(payload); } catch (_) {}
            }
        });
    }
}

module.exports = { broadcastBotResponse };
