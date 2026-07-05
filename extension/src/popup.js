const listPickerRow = document.getElementById('list-picker-row');
const listSelect = document.getElementById('list-select');
const newListBtn = document.getElementById('new-list-btn');
const newListRow = document.getElementById('new-list-row');
const newListInput = document.getElementById('new-list-input');
const newListConfirm = document.getElementById('new-list-confirm');
const newListCancel = document.getElementById('new-list-cancel');
const captureBtn = document.getElementById('capture-btn');
const pendingListEl = document.getElementById('pending-list');
const emptyMessage = document.getElementById('empty-message');
const cancelBtn = document.getElementById('cancel-btn');
const submitBtn = document.getElementById('submit-btn');
const statusMessage = document.getElementById('status-message');
const optionsLink = document.getElementById('options-link');

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

    if (selectId) listSelect.value = String(selectId);
    else if (lists.length > 0) listSelect.value = String(lists[0].list_id);
  } catch (e) {
    statusMessage.textContent = e.message;
  }
}

listSelect.addEventListener('change', renderPending);

function showNewListRow() {
  listPickerRow.hidden = true;
  newListRow.hidden = false;
  newListInput.value = '';
  newListInput.focus();
}

function hideNewListRow() {
  newListRow.hidden = true;
  listPickerRow.hidden = false;
}

newListBtn.addEventListener('click', showNewListRow);

newListCancel.addEventListener('click', hideNewListRow);

newListInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') newListConfirm.click();
  else if (e.key === 'Escape') hideNewListRow();
});

newListConfirm.addEventListener('click', async () => {
  const name = newListInput.value.trim();
  if (!name) {
    statusMessage.textContent = 'List name cannot be blank.';
    return;
  }
  try {
    statusMessage.textContent = '';
    const newId = await createList(name);
    hideNewListRow();
    await loadLists(newId);
    await renderPending();
  } catch (e) {
    statusMessage.textContent = e.message;
  }
});

captureBtn.addEventListener('click', async () => {
  statusMessage.textContent = '';
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error('No active tab found.');
    await browser.tabs.sendMessage(tab.id, { type: MSG.ENTER_CAPTURE_MODE });
    window.close();
  } catch (e) {
    statusMessage.textContent = "This page isn't a supported comic site yet.";
  }
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

  submitBtn.disabled = pending.length === 0 || !listSelect.value;
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
