const listSelect = document.getElementById('list-select');
const newListBtn = document.getElementById('new-list-btn');
const pendingListEl = document.getElementById('pending-list');
const emptyMessage = document.getElementById('empty-message');
const cancelBtn = document.getElementById('cancel-btn');
const submitBtn = document.getElementById('submit-btn');
const statusMessage = document.getElementById('status-message');
const optionsLink = document.getElementById('options-link');

const NEW_LIST_VALUE = '__new__';

async function init() {
  await loadLists();
  await renderPending();
}

async function loadLists(selectId) {
  try {
    const lists = await fetchLists();
    listSelect.innerHTML = '';
    for (const list of lists) {
      const opt = document.createElement('option');
      opt.value = String(list.list_id);
      opt.textContent = list.list_name;
      listSelect.appendChild(opt);
    }
    const newOpt = document.createElement('option');
    newOpt.value = NEW_LIST_VALUE;
    newOpt.textContent = '+ Create a New List';
    listSelect.appendChild(newOpt);

    if (selectId) listSelect.value = String(selectId);
    else if (lists.length > 0) listSelect.value = String(lists[0].list_id);
  } catch (e) {
    statusMessage.textContent = e.message;
  }
}

listSelect.addEventListener('change', async () => {
  if (listSelect.value === NEW_LIST_VALUE) {
    const name = prompt('New reading list name:');
    if (!name || !name.trim()) {
      await loadLists();
      return;
    }
    try {
      const newId = await createList(name.trim());
      await loadLists(newId);
    } catch (e) {
      statusMessage.textContent = e.message;
    }
  }
  await renderPending();
});

newListBtn.addEventListener('click', () => {
  listSelect.value = NEW_LIST_VALUE;
  listSelect.dispatchEvent(new Event('change'));
});

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

async function renderPending() {
  const { pending } = await sendToBackground(MSG.GET_PENDING);
  pendingListEl.innerHTML = '';
  emptyMessage.style.display = pending.length === 0 ? 'block' : 'none';

  for (const item of pending) {
    const li = document.createElement('li');
    li.className = 'pending-item';

    const text = document.createElement('div');
    text.className = 'pending-item-text';
    text.innerHTML = `<strong>${escapeHtml(item.series)} #${escapeHtml(item.number ?? '?')}</strong><br /><span class="pending-item-meta">${escapeHtml(
      item.publisher ?? ''
    )} ${escapeHtml(item.publishDate ?? '')}</span>`;

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'pending-item-remove';
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', async () => {
      await sendToBackground(MSG.REMOVE_PENDING, { tempId: item.tempId });
      await renderPending();
    });

    li.appendChild(text);
    li.appendChild(removeBtn);
    pendingListEl.appendChild(li);
  }

  submitBtn.disabled = pending.length === 0 || listSelect.value === NEW_LIST_VALUE;
}

cancelBtn.addEventListener('click', async () => {
  await sendToBackground(MSG.CLEAR_PENDING);
  await renderPending();
});

submitBtn.addEventListener('click', async () => {
  statusMessage.textContent = 'Submitting…';
  submitBtn.disabled = true;
  try {
    await sendToBackground(MSG.SUBMIT_PENDING, { listId: Number(listSelect.value) });
    statusMessage.textContent = 'Added!';
  } catch (e) {
    statusMessage.textContent = e.message;
  } finally {
    await renderPending();
  }
});

optionsLink.addEventListener('click', () => browser.runtime.openOptionsPage());

init();
