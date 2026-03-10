export function buildConsoleHeaders({ userId, email, name, department, roles, locale }) {
  return {
    "Content-Type": "application/json",
    "x-user-id": userId,
    "x-user-email": email,
    "x-user-name": name,
    "x-user-department": department,
    "x-user-roles": roles,
    "x-locale": locale,
  };
}

async function parseResponseBody(response) {
  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export async function apiFetch(url, getHeadersOrOptions = {}, maybeOptions = {}) {
  const getHeaders = typeof getHeadersOrOptions === "function" ? getHeadersOrOptions : null;
  const options = getHeaders ? maybeOptions : (getHeadersOrOptions ?? {});
  const baseHeaders = getHeaders ? getHeaders() : {};

  const response = await fetch(url, {
    ...options,
    headers: { ...baseHeaders, ...(options.headers ?? {}) },
  });

  const body = await parseResponseBody(response);
  if (!response.ok) {
    throw new Error(`${response.status}: ${JSON.stringify(body)}`);
  }

  return body;
}

let consoleConfigPromise = null;

export async function getConsoleConfig() {
  if (!consoleConfigPromise) {
    consoleConfigPromise = (async () => {
      const response = await fetch("/participant/config");
      if (!response.ok) {
        throw new Error("participant_config_unavailable");
      }

      return parseResponseBody(response);
    })();
  }

  return consoleConfigPromise;
}
