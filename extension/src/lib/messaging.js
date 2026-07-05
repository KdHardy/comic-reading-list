const MSG = {
  ITEM_DETECTED: 'ITEM_DETECTED', // content script -> background: user clicked a comic (or "Add All")
  GET_PENDING: 'GET_PENDING', // popup -> background
  REMOVE_PENDING: 'REMOVE_PENDING', // popup -> background
  SUBMIT_PENDING: 'SUBMIT_PENDING', // popup -> background
  CLEAR_PENDING: 'CLEAR_PENDING', // popup -> background
  ENTER_CAPTURE_MODE: 'ENTER_CAPTURE_MODE', // popup -> content script (sent directly to the active tab)
};

async function sendToBackground(type, payload) {
  const response = await browser.runtime.sendMessage({ type, payload });
  if (response && response.error) throw new Error(response.error);
  return response;
}
