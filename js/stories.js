(() => {
  "use strict";

  const functionsBase = typeof SUPABASE_FUNCTIONS_BASE_URL === "string"
    ? SUPABASE_FUNCTIONS_BASE_URL
    : "https://cmrdapfuqtjlmpepfwfq.supabase.co/functions/v1";
  const storyDateFormatter = new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  });

  const fetchPublicStories = async ({ slug = "", limit = null } = {}) => {
    const url = new URL(`${functionsBase}/public-stories`);
    if (slug) url.searchParams.set("slug", slug);
    if (limit !== null) url.searchParams.set("limit", String(limit));
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Public stories request failed with status ${response.status}`);
    const payload = await response.json();
    if (!payload || !Array.isArray(payload.stories)) throw new Error("Public stories response is invalid");
    return payload.stories;
  };

  const publishedDate = (story) => {
    const date = new Date(story.published_at);
    return Number.isNaN(date.getTime()) ? null : date;
  };

  const detailHref = (slug) => `kisah-detail.html?slug=${encodeURIComponent(slug)}`;

  const makeImage = (story) => {
    if (!story.cover_image_url) return null;
    const image = document.createElement("img");
    image.src = story.cover_image_url;
    image.alt = story.cover_image_alt || "";
    image.loading = "lazy";
    image.decoding = "async";
    return image;
  };

  const makeMeta = (story) => {
    const meta = document.createElement("div");
    meta.className = "kisah-meta";
    const label = document.createElement("span");
    label.textContent = story.title;
    meta.append(label);
    const date = publishedDate(story);
    if (date) {
      const time = document.createElement("time");
      time.dateTime = date.toISOString();
      time.textContent = storyDateFormatter.format(date);
      meta.append(time);
    }
    return meta;
  };

  const makeStoryLink = (story) => {
    const link = document.createElement("a");
    link.className = "kisah-text-link";
    link.href = detailHref(story.slug);
    link.setAttribute("aria-label", `Baca kisah ${story.title}`);
    link.append(document.createTextNode("Baca kisah "));
    const arrow = document.createElement("span");
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = "→";
    link.append(arrow);
    return link;
  };

  const makeStoryCard = (story, className = "kisah-entry", headingLevel = 2) => {
    const article = document.createElement("article");
    article.className = className;
    const image = makeImage(story);
    if (image) article.append(image);
    else article.classList.add("has-no-cover");
    article.append(makeMeta(story));
    const heading = document.createElement(`h${headingLevel}`);
    heading.textContent = story.title;
    article.append(heading);
    if (story.excerpt) {
      const excerpt = document.createElement("p");
      excerpt.textContent = story.excerpt;
      article.append(excerpt);
    }
    article.append(makeStoryLink(story));
    return article;
  };

  const renderHomepageStories = async () => {
    const container = document.querySelector("[data-home-stories]");
    if (!container) return;
    const state = document.querySelector("[data-home-stories-state]");
    try {
      const stories = await fetchPublicStories({ limit: 3 });
      if (!stories.length) {
        state.textContent = "Belum ada kisah yang diterbitkan.";
        return;
      }
      container.replaceChildren();
      container.append(makeStoryCard(stories[0], "kisah-entry kisah-entry-featured", 3));
      if (stories.length > 1) {
        const secondary = document.createElement("div");
        secondary.className = "kisah-secondary-list";
        stories.slice(1).forEach((story) => secondary.append(
          makeStoryCard(story, "kisah-entry kisah-entry-secondary", 3),
        ));
        container.append(secondary);
      } else {
        container.classList.add("has-single-story");
      }
      const count = document.querySelector("[data-home-story-count]");
      if (count) count.textContent = `${String(stories.length).padStart(2, "0")} cerita pilihan`;
      const newestDate = publishedDate(stories[0]);
      const year = document.querySelector("[data-home-story-year]");
      if (year && newestDate) year.textContent = `Catatan ${newestDate.getFullYear()}`;
      state.hidden = true;
      container.hidden = false;
    } catch {
      state.textContent = "Kisah belum dapat dimuat. Silakan coba lagi nanti.";
    }
  };

  const renderArchiveStories = async () => {
    const latestContainer = document.querySelector("[data-story-latest]");
    const archiveContainer = document.querySelector("[data-story-archive]");
    if (!latestContainer || !archiveContainer) return;
    const state = document.querySelector("[data-stories-state]");
    try {
      const stories = await fetchPublicStories();
      if (!stories.length) {
        state.textContent = "Belum ada kisah yang diterbitkan.";
        return;
      }
      const latest = stories[0];
      const latestArticle = document.createElement("article");
      latestArticle.className = "kisah-latest-story";
      const latestImage = makeImage(latest);
      if (latestImage) latestArticle.append(latestImage);
      else latestArticle.classList.add("has-no-cover");
      const copy = document.createElement("div");
      copy.className = "kisah-latest-copy";
      copy.append(makeMeta(latest));
      const heading = document.createElement("h2");
      heading.textContent = latest.title;
      copy.append(heading);
      if (latest.excerpt) {
        const excerpt = document.createElement("p");
        excerpt.textContent = latest.excerpt;
        copy.append(excerpt);
      }
      copy.append(makeStoryLink(latest));
      latestArticle.append(copy);
      latestContainer.replaceChildren(latestArticle);

      const latestDate = publishedDate(latest);
      const dateLabel = document.querySelector("[data-story-latest-date]");
      if (dateLabel && latestDate) dateLabel.textContent = storyDateFormatter.format(latestDate);

      const remaining = stories.slice(1);
      archiveContainer.replaceChildren();
      remaining.forEach((story) => archiveContainer.append(makeStoryCard(story)));
      const count = document.querySelector("[data-story-archive-count]");
      if (count) count.textContent = `${remaining.length} kisah`;
      state.hidden = true;
      latestContainer.hidden = false;
      archiveContainer.hidden = remaining.length === 0;
    } catch {
      state.textContent = "Arsip kisah belum dapat dimuat. Silakan coba lagi nanti.";
    }
  };

  const renderStoryDetail = async () => {
    const article = document.querySelector("[data-story-detail]");
    if (!article) return;
    const state = document.querySelector("[data-story-detail-state]");
    const slug = new URLSearchParams(window.location.search).get("slug")?.trim() || "";
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      state.textContent = "Kisah tidak ditemukan.";
      return;
    }
    try {
      const stories = await fetchPublicStories({ slug });
      if (stories.length !== 1) {
        state.textContent = "Kisah tidak ditemukan.";
        return;
      }
      const story = stories[0];
      document.title = `${story.title} — Kita Bahagia`;
      const title = document.querySelector("[data-story-detail-title]");
      title.textContent = story.title;
      const date = publishedDate(story);
      const time = document.querySelector("[data-story-detail-date]");
      if (date) {
        time.dateTime = date.toISOString();
        time.textContent = storyDateFormatter.format(date);
      } else {
        time.hidden = true;
      }
      const cover = document.querySelector("[data-story-detail-cover]");
      if (story.cover_image_url) {
        cover.src = story.cover_image_url;
        cover.alt = story.cover_image_alt || "";
      } else {
        cover.closest("figure").hidden = true;
      }
      const body = document.querySelector("[data-story-detail-body]");
      body.replaceChildren();
      story.body.split(/\r?\n\s*\r?\n/).filter((paragraph) => paragraph.trim()).forEach((paragraph) => {
        const element = document.createElement("p");
        element.textContent = paragraph.trim();
        body.append(element);
      });
      state.hidden = true;
      article.hidden = false;
    } catch {
      state.textContent = "Kisah belum dapat dimuat. Silakan coba lagi nanti.";
    }
  };

  renderHomepageStories();
  renderArchiveStories();
  renderStoryDetail();
})();
