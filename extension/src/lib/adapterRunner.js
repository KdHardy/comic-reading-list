/**
 * Shared glue between a site adapter (see src/adapters/*.js) and the extension.
 * Each adapter implements: getPageType(), getItemCards(), parseCard(card),
 * parseDetailPage() — then calls initAdapter(adapter) once, at the bottom of
 * its file. This file injects the actual clickable UI on the page and wires
 * clicks to messages sent to the background worker.
 */

function initAdapter(adapter) {
  const pageType = adapter.getPageType();
  if (!pageType) return; // Not a page this adapter recognizes.

  if (pageType === 'detail') {
    injectFloatingButton('+ Add to Reading List', async () => {
      const book = adapter.parseDetailPage();
      await reportItem(book);
      flashFloatingButton('Added!');
    });
  } else if (pageType === 'list') {
    const cards = adapter.getItemCards();

    cards.forEach((card) => {
      injectCardButton(card, async (btn) => {
        const book = adapter.parseCard(card);
        await reportItem(book);
        btn.textContent = '✓';
        btn.disabled = true;
      });
    });

    if (cards.length > 0) {
      injectFloatingButton(`+ Add All (${cards.length})`, async () => {
        for (const card of cards) {
          const book = adapter.parseCard(card);
          // eslint-disable-next-line no-await-in-loop
          await reportItem(book);
        }
        flashFloatingButton('Added all!');
      });
    }
  }
}

async function reportItem(book) {
  return sendToBackground(MSG.ITEM_DETECTED, book);
}

function injectFloatingButton(label, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = label;
  btn.className = 'reading-list-floating-button';
  btn.addEventListener('click', onClick);
  document.body.appendChild(btn);
  return btn;
}

function flashFloatingButton(text) {
  const btn = document.querySelector('.reading-list-floating-button');
  if (!btn) return;
  const original = btn.textContent;
  btn.textContent = text;
  setTimeout(() => {
    btn.textContent = original;
  }, 1500);
}

function injectCardButton(card, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = '+';
  btn.title = 'Add to reading list';
  btn.className = 'reading-list-card-button';
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick(btn);
  });

  if (getComputedStyle(card).position === 'static') {
    card.style.position = 'relative';
  }
  card.appendChild(btn);
}
