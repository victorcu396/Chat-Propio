// CAMBIO DE FOTO DE PERFIL
// ============================================================
function abrirModalAvatar() {
    pendingAvatarDataUrl = '';
    // Mostrar la foto actual como preview
    document.getElementById('avatarPreviewBig').src = myAvatarDataUrl;
    document.getElementById('btnGuardarAvatar').disabled = true;
    document.getElementById('avatarModal').classList.add('visible');
}

function cerrarModalAvatar() {
    document.getElementById('avatarModal').classList.remove('visible');
    // Reset el input file para que se pueda volver a seleccionar la misma foto
    document.getElementById('avatarFileInput').value = '';
    pendingAvatarDataUrl = '';
}

function onAvatarFileSelected(event) {
    const file = event.target.files[0];
    if (!file) return;

    // Validar que sea imagen
    if (!file.type.startsWith('image/')) {
        alert('Por favor selecciona un archivo de imagen.');
        return;
    }

    // Validar tamaño (máx 5MB antes de comprimir)
    if (file.size > 5 * 1024 * 1024) {
        alert('La imagen es demasiado grande. Máximo 5MB.');
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        // Comprimir/recortar a cuadrado usando canvas
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const SIZE = 256; // 256x256px es suficiente para avatar
            canvas.width = SIZE;
            canvas.height = SIZE;
            const ctx = canvas.getContext('2d');

            // Recortar al centro en cuadrado
            const minSide = Math.min(img.width, img.height);
            const sx = (img.width  - minSide) / 2;
            const sy = (img.height - minSide) / 2;
            ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, SIZE, SIZE);

            // Exportar como JPEG comprimido (calidad 0.85)
            pendingAvatarDataUrl = canvas.toDataURL('image/jpeg', 0.85);

            // Mostrar preview
            document.getElementById('avatarPreviewBig').src = pendingAvatarDataUrl;
            document.getElementById('btnGuardarAvatar').disabled = false;
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function guardarAvatar() {
    if (!pendingAvatarDataUrl) return;

    myAvatarDataUrl = pendingAvatarDataUrl;

    // Guardar en localStorage para persistir entre sesiones
    localStorage.setItem(`kvs_avatar_${loginPhone}`, myAvatarDataUrl);

    // Actualizar la foto en el sidebar inmediatamente
    document.getElementById('myAvatar').src = myAvatarDataUrl;

    // Notificar al servidor para que actualice el avatar en los próximos mensajes
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
            type: 'updateAvatar',
            avatar: myAvatarDataUrl
        }));
    }

    cerrarModalAvatar();
}

// Cerrar modal al hacer click fuera
document.getElementById('avatarModal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('avatarModal')) cerrarModalAvatar();
});

// ============================================================
