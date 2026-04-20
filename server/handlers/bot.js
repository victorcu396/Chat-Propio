'use strict';
/* ============================================================
   HANDLER: BOT IA
   Detecta el prefijo /bot en mensajes, llama a la API de Groq
   (gratuita) y emite una respuesta bot_response a todos los
   participantes.
============================================================ */

const SYSTEM_PROMPT =
    'Eres un asistente de chat útil, conciso y amigable integrado en kiVooSpace. ' +
    'Responde siempre en el mismo idioma de la pregunta. ' +
    'Sé directo: sin introducciones largas ni despedidas. ' +
    'Si la respuesta puede ser larga, usa listas o párrafos cortos para facilitar la lectura.';

async function callGroq(query) {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
        },
        body: JSON.stringify({
            model:       'llama-3.1-8b-instant',
            messages:    [
                { role: 'system', content: SYSTEM_PROMPT },
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
   Llama a Groq, guarda el mensaje bot en BD y lo emite a los participantes.

   Parámetros:
     query          — texto de la pregunta (sin "/bot ")
     askedBy        — username de quien preguntó
     conversationId — ID de la conversación (1:1 o group_XXX)
     toUsername     — destinatario en 1:1 (null para grupos)
     groupId        — ID de grupo (null para 1:1)
     grpMembers     — array de phones de miembros (solo grupos)
     ctx            — contexto del servidor (Message, crypto, users, WebSocket, etc.)
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

    let botText;
    try {
        botText = await callGroq(query);
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
