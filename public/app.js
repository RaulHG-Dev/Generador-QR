const form = document.getElementById('qr-form');
const recordIdInput = document.getElementById('record-id');
const submitButton = document.getElementById('submit-button');
const cancelEditButton = document.getElementById('cancel-edit');
const editNote = document.getElementById('edit-note');
const preview = document.getElementById('preview');
const history = document.getElementById('history');
const status = document.getElementById('status');
const downloadLink = document.getElementById('download-link');

let currentDownloadUrl = null;

function setStatus(message, isError = false) {
  status.textContent = message;
  status.style.color = isError ? '#9f1239' : '';
}

function setDownload(svg, fileName) {
  if (currentDownloadUrl) {
    URL.revokeObjectURL(currentDownloadUrl);
  }

  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  currentDownloadUrl = URL.createObjectURL(blob);
  downloadLink.href = currentDownloadUrl;
  downloadLink.download = fileName;
  downloadLink.setAttribute('aria-disabled', 'false');
}

function resetDownloadLink() {
  if (currentDownloadUrl) {
    URL.revokeObjectURL(currentDownloadUrl);
    currentDownloadUrl = null;
  }

  downloadLink.href = '#';
  downloadLink.download = 'qr.svg';
  downloadLink.setAttribute('aria-disabled', 'true');
}

function resetFormMode() {
  recordIdInput.value = '';
  submitButton.textContent = 'Generar QR';
  cancelEditButton.hidden = true;
  editNote.hidden = true;
  form.reset();
}

function enterEditMode(record) {
  recordIdInput.value = record.id;
  form.elements.title.value = record.title;
  form.elements.url.value = record.sourceUrl;
  form.elements.color.value = record.colorHex;
  form.elements.icon.value = '';
  submitButton.textContent = 'Actualizar QR';
  cancelEditButton.hidden = false;
  editNote.hidden = false;
  setStatus(`Editando el registro ${record.id}.`);
}

async function loadRecordPreview(record) {
  const response = await fetch(`/api/qr/${record.id}/download`);
  if (!response.ok) {
    throw new Error('No se pudo cargar la vista previa del QR.');
  }

  const svg = await response.text();
  preview.classList.remove('empty');
  preview.innerHTML = svg;
  setDownload(svg, `${normalizeFileName(record.title)}.svg`);
}

async function duplicateRecord(record) {
  const response = await fetch(`/api/qr/${record.id}/duplicate`, {
    method: 'POST'
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || 'No se pudo duplicar el QR.');
  }

  const duplicatedRecord = payload.record;
  enterEditMode(duplicatedRecord);
  preview.classList.remove('empty');
  preview.innerHTML = payload.svg;
  setDownload(payload.svg, `${normalizeFileName(duplicatedRecord.title)}.svg`);
  setStatus(`Se duplicó el QR y ahora puedes editar la copia ${duplicatedRecord.id}.`);
  await loadHistory();
}

function truncateUrl(value) {
  return value.length > 90 ? `${value.slice(0, 87)}...` : value;
}

function formatDate(value) {
  return new Intl.DateTimeFormat('es-ES', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value));
}

function normalizeFileName(value) {
  const safeValue = String(value || 'qr')
    .trim()
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return safeValue || 'qr';
}

async function loadHistory() {
  const response = await fetch('/api/history');
  const data = await response.json();

  history.innerHTML = '';
  if (!data.records.length) {
    history.innerHTML = '<p class="hint">Aún no hay códigos QR guardados.</p>';
    return;
  }

  data.records.forEach((record) => {
    const item = document.createElement('article');
    item.className = 'history-item';
    item.innerHTML = `
      <div>
        <strong>${record.title}</strong>
        <small>${truncateUrl(record.sourceUrl)}</small>
        <small>Color: ${record.colorHex}</small>
        <small>${formatDate(record.createdAt)}</small>
      </div>
      <div class="actions">
        <div class="swatch" style="background:${record.colorHex}"></div>
        <a class="download-link" href="/api/qr/${record.id}/download" download="${normalizeFileName(record.title)}.svg">Descargar</a>
        <button type="button" class="secondary-button" data-action="duplicate" data-record-id="${record.id}">Duplicar</button>
        <button type="button" class="secondary-button" data-action="edit" data-record-id="${record.id}">Editar</button>
        <button type="button" class="danger-button" data-action="delete" data-record-id="${record.id}">Eliminar</button>
      </div>
    `;
    item.dataset.recordId = record.id;
    item.dataset.title = record.title;
    item.dataset.sourceUrl = record.sourceUrl;
    item.dataset.colorHex = record.colorHex;
    item.dataset.createdAt = record.createdAt;
    history.appendChild(item);
  });
}

history.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) {
    return;
  }

  const action = button.dataset.action;
  const recordId = button.dataset.recordId;
  const item = button.closest('.history-item');
  const record = {
    id: recordId,
    title: item.dataset.title,
    sourceUrl: item.dataset.sourceUrl,
    colorHex: item.dataset.colorHex,
    createdAt: item.dataset.createdAt
  };

  if (action === 'edit') {
    try {
      enterEditMode(record);
      await loadRecordPreview(record);
      setStatus(`Editando el QR de ${truncateUrl(record.sourceUrl)}.`);
    } catch (error) {
      setStatus(error.message, true);
    }
    return;
  }

  if (action === 'duplicate') {
    try {
      await duplicateRecord(record);
    } catch (error) {
      setStatus(error.message, true);
    }
    return;
  }

  if (action === 'delete') {
    const confirmed = window.confirm('¿Eliminar este QR del historial local?');
    if (!confirmed) {
      return;
    }

    try {
      const response = await fetch(`/api/qr/${recordId}`, { method: 'DELETE' });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'No se pudo eliminar el QR.');
      }

      if (recordIdInput.value === recordId) {
        resetFormMode();
        preview.classList.add('empty');
        preview.innerHTML = '<span>El QR aparecerá aquí.</span>';
        setStatus('El registro en edición fue eliminado.');
      } else {
        setStatus('QR eliminado del historial local.');
      }

      await loadHistory();
    } catch (error) {
      setStatus(error.message, true);
    }
  }
});

cancelEditButton.addEventListener('click', () => {
  resetFormMode();
  preview.classList.add('empty');
  preview.innerHTML = '<span>El QR aparecerá aquí.</span>';
  setStatus('Edición cancelada.');
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const editId = recordIdInput.value.trim();
  setStatus(editId ? 'Actualizando QR...' : 'Generando QR...');

  const formData = new FormData(form);
  const method = editId ? 'PUT' : 'POST';
  const endpoint = editId ? `/api/qr/${editId}` : '/api/qr';

  try {
    const response = await fetch(endpoint, {
      method,
      body: formData
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'No se pudo generar el QR.');
    }

    preview.classList.remove('empty');
    preview.innerHTML = payload.svg;
    setDownload(payload.svg, `${normalizeFileName(payload.record.title)}.svg`);
    setStatus(editId ? `QR actualizado en SQLite con ID ${payload.record.id}.` : `QR generado y guardado en SQLite con ID ${payload.record.id}.`);
    resetFormMode();
    await loadHistory();
  } catch (error) {
    preview.classList.add('empty');
    preview.innerHTML = '<span>El QR aparecerá aquí.</span>';
    setStatus(error.message, true);
  }
});

loadHistory().catch(() => {
  history.innerHTML = '<p class="hint">No fue posible cargar el historial.</p>';
});
