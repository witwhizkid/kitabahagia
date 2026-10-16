// Post-event feedback (feedback.html?t=<token> from the certificate email). Uses public-feedback;
// the thank-you screen reuses renderLinkEvents (script.js) for the next open events.
(() => {
  "use strict";
  const endpoint = `${SUPABASE_FUNCTIONS_BASE_URL}/public-feedback`;
  const token = new URLSearchParams(window.location.search).get("t") || "";
  const state = document.querySelector("[data-feedback-state]");
  const form = document.querySelector("[data-feedback-form]");
  const thanks = document.querySelector("[data-feedback-thanks]");
  const error = document.querySelector("[data-feedback-error]");
  if (!form) return;

  const showThanks = () => {
    form.hidden = true;
    thanks.hidden = false;
    thanks.focus();
    window.scrollTo(0, 0);
  };
  const fill = (saved) => {
    if (!saved) return;
    form.querySelector(`input[name="rating"][value="${saved.rating}"]`)?.click();
    (saved.highlights || []).forEach((key) => {
      const box = form.querySelector(`input[name="highlights"][value="${key}"]`);
      if (box) box.checked = true;
    });
    form.elements.message.value = saved.message || "";
    form.elements.anonymous.checked = Boolean(saved.anonymous);
  };

  const load = async () => {
    if (!/^[a-f0-9]{32}$/.test(token)) {
      state.textContent = "Link feedback tidak dikenali. Buka lagi dari email sertifikatmu, ya.";
      return;
    }
    try {
      const response = await fetch(`${endpoint}?t=${token}`, { cache: "no-store" });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.event) throw new Error(data?.error?.message || "Halaman feedback belum dapat dimuat.");
      document.querySelector("[data-feedback-title]").textContent = data.first_name ? `Gimana kegiatannya, ${data.first_name}?` : "Gimana kegiatannya?";
      document.querySelector("[data-feedback-event]").textContent = data.event.title;
      const date = data.event.date ? new Intl.DateTimeFormat("id-ID", { weekday: "long", day: "numeric", month: "short", timeZone: "Asia/Jakarta" }).format(new Date(`${data.event.date}T12:00:00+07:00`)) : "";
      document.querySelector("[data-feedback-meta]").textContent = [date, data.event.location].filter(Boolean).join(" · ");
      const poster = document.querySelector("[data-feedback-poster]");
      if (data.event.image) { poster.src = data.event.image; poster.hidden = false; }
      fill(data.feedback);
      state.hidden = true;
      form.hidden = false;
    } catch (err) {
      state.textContent = err.message;
    }
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const rating = Number(form.querySelector('input[name="rating"]:checked')?.value || 0);
    error.hidden = true;
    if (!rating) {
      error.textContent = "Pilih dulu seberapa seru kegiatannya, ya.";
      error.hidden = false;
      return;
    }
    const button = form.querySelector(".feedback-submit");
    button.disabled = true;
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          t: token,
          rating,
          highlights: [...form.querySelectorAll('input[name="highlights"]:checked')].map((box) => box.value),
          message: form.elements.message.value,
          anonymous: form.elements.anonymous.checked,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error?.message || "Feedback belum tersimpan. Coba lagi sebentar.");
      showThanks();
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    } finally {
      button.disabled = false;
    }
  });
  document.querySelector("[data-feedback-edit]").addEventListener("click", () => {
    thanks.hidden = true;
    form.hidden = false;
  });
  void load();
})();
