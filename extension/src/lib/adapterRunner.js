/**
 * Shared glue between a site adapter (see src/adapters/*.js) and the
 * extension's "capture mode" flow.
 *
 * Each adapter implements getPageType(), and either getItemCards() +
 * parseCard() (list pages) or parseDetailPage() (detail pages), then calls
 * initAdapter(adapter) once at the bottom of its file.
 *
 * Nothing happens on page load. When the user clicks "Add Comic from Page"
 * in the popup, the popup messages this tab directly (MSG.ENTER_CAPTURE_MODE)
 * and this script arms capture mode:
 *   - Detail page (one book): the next click anywhere on the page adds it.
 *   - List page (many books): a highlight box is drawn over every detected
 *     item right away, plus an "Add All" button; clicking a box adds just
 *     that book, clicking "Add All" adds every detected book.
 * Escape cancels capture mode at any point without adding anything.
 */

let currentAdapter = null;
let captureActive = false;

function initAdapter(adapter) {
  currentAdapter = adapter;
  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === MSG.ENTER_CAPTURE_MODE) {
      armCapture();
      sendResponse({ ok: true });
    }
  });
}

function armCapture() {
  if (!currentAdapter || captureActive) return;

  const pageType = currentAdapter.getPageType();
  if (!pageType) {
    showBanner("This page isn't a recognized comic list or detail page.");
    setTimeout(removeBanner, 2200);
    return;
  }

  captureActive = true;
  document.addEventListener('keydown', onKeyDown, true);

  if (pageType === 'detail') {
    showBanner('Click anywhere on the page to add this comic… (Esc to cancel)');
    document.addEventListener('click', onDetailClick, { capture: true, once: true });
  } else if (pageType === 'list') {
    showItemBoxes();
  }
}

function disarmCapture() {
  captureActive = false;
  document.removeEventListener('click', onDetailClick, { capture: true });
  document.removeEventListener('keydown', onKeyDown, true);
  removeItemBoxes();
}

function onKeyDown(e) {
  if (e.key === 'Escape') {
    showBanner('Cancelled.');
    setTimeout(removeBanner, 900);
    disarmCapture();
  }
}

function onDetailClick(e) {
  e.preventDefault();
  e.stopPropagation();
  const book = currentAdapter.parseDetailPage();
  reportItem(book);
  showBanner('Added!');
  setTimeout(removeBanner, 1200);
  disarmCapture();
}

function showItemBoxes() {
  const cards = currentAdapter.getItemCards();
  if (cards.length === 0) {
    showBanner('No comics detected on this page.');
    setTimeout(() => {
      removeBanner();
      disarmCapture();
    }, 2000);
    return;
  }

  showBanner(`Click a comic to add it, or use "Add All" below. (Esc to cancel)`);

  cards.forEach((card) => {
    const box = document.createElement('div');
    box.className = 'reading-list-item-box';
    box.title = 'Add this comic';
    box.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const book = currentAdapter.parseCard(card);
      reportItem(book);
      showBanner('Added!');
      setTimeout(removeBanner, 1200);
      disarmCapture();
    });

    if (getComputedStyle(card).position === 'static') {
      card.style.position = 'relative';
    }
    card.appendChild(box);
  });

  const addAllBtn = document.createElement('button');
  addAllBtn.type = 'button';
  addAllBtn.id = 'reading-list-add-all-button';
  addAllBtn.className = 'reading-list-floating-button';
  addAllBtn.textContent = `+ Add All (${cards.length})`;
  addAllBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    for (const card of cards) {
      const book = currentAdapter.parseCard(card);
      // eslint-disable-next-line no-await-in-loop
      await reportItem(book);
    }
    showBanner(`Added all ${cards.length}!`);
    setTimeout(removeBanner, 1500);
    disarmCapture();
  });
  document.body.appendChild(addAllBtn);
}

function removeItemBoxes() {
  document.querySelectorAll('.reading-list-item-box').forEach((el) => el.remove());
  document.getElementById('reading-list-add-all-button')?.remove();
}

async function reportItem(book) {
  return sendToBackground(MSG.ITEM_DETECTED, book);
}

function showBanner(text) {
  removeBanner();
  const banner = document.createElement('div');
  banner.id = 'reading-list-capture-banner';
  banner.className = 'reading-list-capture-banner';
  banner.textContent = text;
  document.body.appendChild(banner);
  return banner;
}

function removeBanner() {
  document.getElementById('reading-list-capture-banner')?.remove();
}
