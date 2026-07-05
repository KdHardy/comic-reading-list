/** Thin fetch-based client for the Supabase REST/RPC endpoints this extension needs. */

async function supabaseRpc(name, params) {
  const config = await getConfig();
  if (!config.supabaseUrl || !config.anonKey) {
    throw new Error('Extension is not configured yet. Right-click the extension icon → Options, and fill in your Supabase details.');
  }
  const res = await fetch(`${config.supabaseUrl}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: config.anonKey,
      Authorization: `Bearer ${config.anonKey}`,
    },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase error (${res.status}): ${text}`);
  }
  return res.status === 204 ? null : res.json();
}

async function supabaseSelect(table, query) {
  const config = await getConfig();
  if (!config.supabaseUrl || !config.anonKey) {
    throw new Error('Extension is not configured yet. Right-click the extension icon → Options, and fill in your Supabase details.');
  }
  const res = await fetch(`${config.supabaseUrl}/rest/v1/${table}?${query}`, {
    headers: { apikey: config.anonKey, Authorization: `Bearer ${config.anonKey}` },
  });
  if (!res.ok) throw new Error(`Supabase error (${res.status})`);
  return res.json();
}

async function fetchLists() {
  return supabaseSelect('reading_list', 'select=list_id,list_name&order=created_date.asc');
}

async function createList(name) {
  const config = await getConfig();
  return supabaseRpc('create_reading_list', { p_secret: config.writeSecret, p_list_name: name });
}

async function addBookToList(listId, book) {
  const config = await getConfig();
  return supabaseRpc('add_book_to_list', {
    p_secret: config.writeSecret,
    p_list_id: listId,
    p_series: book.series,
    p_publisher: book.publisher ?? null,
    p_volume: book.volume ?? null,
    p_number: book.number ?? null,
    p_event: book.event ?? null,
    p_publish_date: book.publishDate ?? null,
    p_thumbnail: book.thumbnail ?? null,
  });
}
