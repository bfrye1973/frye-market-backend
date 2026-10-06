export function safeUpper(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text ? text.toUpperCase() : fallback;
}

export function pickFirst(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== "") return value;
  }
  return null;
}
