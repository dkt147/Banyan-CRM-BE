/*
 * Website pages for CRM forms (client meeting 19 Nov, §2.3). The WordPress plugin creates, updates
 * and bins the page (WP handoff §1: POST /crm-pages, DELETE /crm-pages/{id}); the CRM keeps
 * form.page = { url, path, wpPageId, status, publishedAt, error }.
 */
import { env } from "../config/env.js";
import { AppError } from "../utils/AppError.js";
import { WP_SYNC_NOT_CONFIGURED_MESSAGE } from "./wpRoomBooking.service.js";

export const PAGE_PATH_RX = /^[a-z0-9-]+(\/[a-z0-9-]+)?$/;
const UNSUPPORTED = "The website plugin can't create form pages yet (needs the CRM pages update). Ask the website developer to install it.";

async function wpPages(path, { method, body }) {
  if (!env.BANYAN_CRM_TOKEN) throw new AppError(WP_SYNC_NOT_CONFIGURED_MESSAGE, 503, "WP_BOOKING_NOT_CONFIGURED");
  let res;
  try {
    res = await fetch(new URL(path, env.BANYAN_WP_API_URL), {
      method,
      headers: { Accept: "application/json", "Content-Type": "application/json", "X-Banyan-Token": env.BANYAN_CRM_TOKEN },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
  } catch (error) {
    throw new AppError(`WordPress is unreachable: ${error.message}`, 502, "WP_PAGES_UNREACHABLE");
  }
  const json = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, json };
}

/** Create or update the page for a form. Returns the new form.page. */
export async function publishFormPage(form, path) {
  if (!form.isActive) throw new AppError("This form is switched off. Turn it on before making a page for it.", 400, "FORM_INACTIVE");
  const clean = String(path || "").trim().toLowerCase().replace(/^\/+|\/+$/g, "");
  if (!PAGE_PATH_RX.test(clean))
    throw new AppError("The page address uses lowercase letters, numbers and hyphens, with at most one slash (e.g. forms/walk-in).", 400, "INVALID_PAGE_PATH");
  const r = await wpPages("crm-pages", {
    method: "POST",
    body: { form_slug: form.slug, path: clean, title: String(form.design?.title || form.name).slice(0, 160), wp_page_id: form.page?.wpPageId ?? null },
  });
  if (r.status === 404 && r.json?.code === "rest_no_route") throw new AppError(UNSUPPORTED, 501, "WP_PAGES_UNSUPPORTED");
  if (r.status === 409)
    throw new AppError(r.json?.message || `The address /${clean}/ is already used by another page on the website.`, 409, "PAGE_PATH_TAKEN");
  if (r.status === 404 && form.page?.wpPageId)
    throw new AppError("The form's page was not found on the website (it may have been deleted). Remove the page link and create it again.", 404, "PAGE_NOT_FOUND");
  if (!r.ok) throw new AppError(r.json?.message || `WordPress returned ${r.status}.`, r.status === 400 ? 400 : 502, "WP_PAGES_FAILED");
  form.page = {
    url: r.json.url || null,
    path: clean,
    wpPageId: r.json.id ?? form.page?.wpPageId ?? null,
    status: r.json.status || "publish",
    publishedAt: form.page?.publishedAt || new Date(),
    updatedAt: new Date(),
    error: null,
  };
  form.markModified("page");
  await form.save();
  return form.page;
}

/** Move the page to the WordPress bin and clear form.page. A page already gone counts as removed. */
export async function removeFormPage(form) {
  const id = form.page?.wpPageId;
  if (id) {
    const r = await wpPages(`crm-pages/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (r.status === 404 && r.json?.code === "rest_no_route") throw new AppError(UNSUPPORTED, 501, "WP_PAGES_UNSUPPORTED");
    if (!r.ok && r.status !== 404) throw new AppError(r.json?.message || `WordPress returned ${r.status}.`, 502, "WP_PAGES_FAILED");
  }
  form.page = null;
  form.markModified("page");
  await form.save();
  return { removed: true };
}
