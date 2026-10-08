export function progressSnapshot({
  phase,
  processed,
  total,
  index = null,
  message = null,
  ok = null,
  error = null,
  code = null,
}) {
  const raw = total > 0 ? Math.round((processed / total) * 100) : 0;
  let percent = Math.min(99, raw);
  if (phase === 'completed') percent = 100;
  if (phase === 'failed') percent = Math.min(100, raw);
  return { phase, processed, total, percent, index, message, ok, error, code };
}

export function feed(field, payload) {
  return { [field]: payload };
}

export function errorText(error) {
  return error?.message || 'Unknown error';
}
