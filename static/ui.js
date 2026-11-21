/* Shared UI helpers. Every dynamic string goes through esc() before reaching innerHTML. */
"use strict";

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function api(path, { method = "GET", body } = {}) {
  let response;
  try {
    response = await fetch(path, {
      method,
      headers: { "X-ProofPath-Client": "web", ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new ApiError(0, "NETWORK", "Could not reach the ProofPath server.");
  }
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    if (data && data.error) throw new ApiError(response.status, data.error.code, data.error.message);
    if (data && Array.isArray(data.detail)) {
      const first = data.detail[0];
      const where = (first.loc || []).slice(1).join(" → ");
      throw new ApiError(response.status, "VALIDATION", `${where ? where + ": " : ""}${first.msg}`);
    }
    throw new ApiError(response.status, "HTTP_" + response.status, "Request failed.");
  }
  return data;
}

function toast(message) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 3200);
}

const ERROR_TITLES = {
  LLM_UNAVAILABLE: "AI engine not configured",
  LLM_FAILED: "The AI step failed. Nothing was faked.",
  NETWORK: "Server unreachable",
  VALIDATION: "Check your input",
  INVALID_INPUT: "Check your input",
  ALREADY_ANSWERED: "Already answered",
  STALE_PROPOSAL: "Proposal is out of date",
  NOT_FOUND: "Not found",
};

function showError(err) {
  const banner = document.getElementById("banner");
  banner.className = "error";
  banner.innerHTML = `<strong>${esc(ERROR_TITLES[err.code] || "Something went wrong")}</strong>${esc(err.message)}`;
  banner.hidden = false;
  banner.scrollIntoView({ block: "nearest" });
}

function clearBanner() {
  const banner = document.getElementById("banner");
  banner.hidden = true;
  banner.innerHTML = "";
}

async function withBusy(button, label, fn) {
  const original = button ? button.innerHTML : "";
  if (button) {
    button.disabled = true;
    button.innerHTML = `<span class="spinner" aria-hidden="true"></span>${esc(label)}`;
  }
  clearBanner();
  try {
    return await fn();
  } catch (err) {
    showError(err instanceof ApiError ? err : new ApiError(0, "CLIENT", err.message));
    return undefined;
  } finally {
    if (button && button.isConnected) {
      button.disabled = false;
      button.innerHTML = original;
    }
  }
}

const LEVEL_LABEL = {
  none: "No evidence",
  claimed: "Claimed",
  partial: "Partial",
  demonstrated: "Demonstrated",
  artifact_backed: "Artifact-backed",
};

const UNCERTAINTY_LABEL = {
  unknown: "Unknown",
  high: "Self-reported",
  medium: "Single check",
  low: "Consistent",
  conflicting: "Conflicting",
};

function ladder(row) {
  const label = `${LEVEL_LABEL[row.level]}${row.contested ? ", contested" : ""}`;
  return `<span class="level"><span class="ladder" data-level="${esc(row.level)}" data-contested="${row.contested}" role="img" aria-label="${esc(label)}"><span></span><span></span><span></span><span></span></span><span>${esc(label)}</span></span>`;
}

function tag(text, cls = "") {
  return `<span class="tag ${esc(cls)}">${esc(text)}</span>`;
}

function uncertaintyTag(value) {
  return tag(UNCERTAINTY_LABEL[value] || value, value);
}

function fmtTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function strength(value) {
  return Number(value).toFixed(2);
}

function words(text) {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}
