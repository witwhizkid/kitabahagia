(() => {
  "use strict";

  const functionsBase = typeof SUPABASE_FUNCTIONS_BASE_URL === "string"
    ? SUPABASE_FUNCTIONS_BASE_URL
    : "https://cmrdapfuqtjlmpepfwfq.supabase.co/functions/v1";
  const storyDateFormatter = new Intl.DateTimeFormat("id-ID", {
    day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Jakarta",
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

  const makeImageLink = (story) => {
    const image = makeImage(story);
    if (!image) return null;
    const link = document.createElement("a");
    link.className = "kisah-image-link";
    link.href = detailHref(story.slug);
    link.setAttribute("aria-label", `Baca kisah ${story.title}`);
    link.append(image);
    return link;
  };

  const makeMeta = (story) => {
    const meta = document.createElement("div");
    meta.className = "kisah-meta";
    const date = publishedDate(story);
    if (date) {
      const time = document.createElement("time");
      time.dateTime = date.toISOString();
      time.textContent = storyDateFormatter.format(date);
      meta.append(time);
    }
    return meta;
  };

  const makeHeading = (story, level) => {
    const heading = document.createElement(`h${level}`);
    const link = document.createElement("a");
    link.className = "kisah-title-link";
    link.href = detailHref(story.slug);
    link.textContent = story.title;
    heading.append(link);
    return heading;
  };

  const makeStoryLink = (story) => {
    const link = document.createElement("a");
    link.className = "kisah-text-link";
    link.href = detailHref(story.slug);
    link.setAttribute("aria-label", `Baca kisah ${story.title}`);
    link.append(document.createTextNode("Baca kisah "));
    const arrow = document.createElement("span");
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = "Ã¢â€ â€™";
    link.append(arrow);
    return link;
  };

  const makeStoryCard = (story, className = "kisah-entry", headingLevel = 2, showAction = false) => {
    const article = document.createElement("article");
    article.className = className;
    const imageLink = makeImageLink(story);
    if (imageLink) article.append(imageLink);
    else article.classList.add("has-no-cover");
    article.append(makeMeta(story), makeHeading(story, headingLevel));
    if (story.excerpt) {
      const excerpt = document.createElement("p");
      excerpt.textContent = story.excerpt;
      article.append(excerpt);
    }
    if (showAction) article.append(makeStoryLink(story));
    return article;
  };

  const setState = (state, type, message, retry) => {
    if (!state) return;
    state.hidden = false;
    state.className = `kisah-data-state is-${type}`;
    state.replaceChildren();
    const copy = document.createElement("span");
    copy.textContent = message;
    state.append(copy);
    if (type === "empty") {
      const link = document.createElement("a");
      link.href = "jadwal.html";
      link.className = "kisah-state-action";
      link.textContent = "Lihat jadwal kegiatan";
      state.append(link);
    } else if (type === "error" && retry) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "kisah-state-action";
      button.textContent = "Coba lagi";
      button.addEventListener("click", retry, { once: true });
      state.append(button);
    }
  };

  const renderHomepageStories = async () => {
    const container = document.querySelector("[data-home-stories]");
    if (!container) return;
    const state = document.querySelector("[data-home-stories-state]");
    container.hidden = true;
    setState(state, "loading", "Memuat kisah terbaruÃ¢â‚¬Â¦");
    try {
      const stories = await fetchPublicStories({ limit: 3 });
      if (!stories.length) {
        setState(state, "empty", "Belum ada kisah yang diterbitkan.");
        return;
      }
      container.replaceChildren();
      container.classList.toggle("has-single-story", stories.length === 1);
      container.append(makeStoryCard(stories[0], "kisah-entry kisah-entry-featured", 3, true));
      if (stories.length > 1) {
        const secondary = document.createElement("div");
        secondary.className = "kisah-secondary-list";
        stories.slice(1).forEach((story) => secondary.append(
          makeStoryCard(story, "kisah-entry kisah-entry-secondary", 3),
        ));
        container.append(secondary);
      }
      state.hidden = true;
      container.hidden = false;
    } catch {
      setState(state, "error", "Kisah belum dapat dimuat.", renderHomepageStories);
    }
  };

  const renderArchiveStories = async () => {
    const latestContainer = document.querySelector("[data-story-latest]");
    const archiveContainer = document.querySelector("[data-story-archive]");
    if (!latestContainer || !archiveContainer) return;
    const state = document.querySelector("[data-stories-state]");
    latestContainer.hidden = true;
    archiveContainer.hidden = true;
    setState(state, "loading", "Memuat arsip kisahÃ¢â‚¬Â¦");
    try {
      const stories = await fetchPublicStories();
      if (!stories.length) {
        setState(state, "empty", "Belum ada kisah yang diterbitkan.");
        return;
      }
      const latest = stories[0];
      const latestArticle = document.createElement("article");
      latestArticle.className = "kisah-latest-story";
      const latestImageLink = makeImageLink(latest);
      if (latestImageLink) latestArticle.append(latestImageLink);
      else latestArticle.classList.add("has-no-cover");
      const copy = document.createElement("div");
      copy.className = "kisah-latest-copy";
      copy.append(makeHeading(latest, 2));
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
      if (dateLabel) dateLabel.textContent = latestDate ? storyDateFormatter.format(latestDate) : "";

      const remaining = stories.slice(1);
      archiveContainer.replaceChildren();
      remaining.forEach((story) => archiveContainer.append(makeStoryCard(story)));
      archiveContainer.classList.remove("has-one-story", "has-two-stories", "has-many-stories");
      archiveContainer.classList.add(remaining.length === 1
        ? "has-one-story"
        : remaining.length === 2 ? "has-two-stories" : "has-many-stories");
      const count = document.querySelector("[data-story-archive-count]");
      if (count) count.textContent = `${remaining.length} kisah`;
      state.hidden = true;
      latestContainer.hidden = false;
      archiveContainer.hidden = remaining.length === 0;
    } catch {
      setState(state, "error", "Arsip kisah belum dapat dimuat.", renderArchiveStories);
    }
  };

  const renderStoryDetail = async () => {
    const article = document.querySelector("[data-story-detail]");
    if (!article) return;
    const state = document.querySelector("[data-story-detail-state]");
    article.hidden = true;
    setState(state, "loading", "Memuat kisahÃ¢â‚¬Â¦");
    const slug = new URLSearchParams(window.location.search).get("slug")?.trim() || "";
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      setState(state, "empty", "Kisah tidak ditemukan.");
      return;
    }
    try {
      const stories = await fetchPublicStories({ slug });
      if (stories.length !== 1) {
        setState(state, "empty", "Kisah tidak ditemukan.");
        return;
      }
      const story = stories[0];
      document.title = `${story.title} Ã¢â‚¬â€ Kita Bahagia`;
      document.querySelector("[data-story-detail-title]").textContent = story.title;
      const date = publishedDate(story);
      const time = document.querySelector("[data-story-detail-date]");
      if (date) {
        time.dateTime = date.toISOString();
        time.textContent = storyDateFormatter.format(date);
        time.hidden = false;
      } else {
        time.hidden = true;
      }
      const cover = document.querySelector("[data-story-detail-cover]");
      const coverFigure = cover.closest("figure");
      if (story.cover_image_url) {
        cover.src = story.cover_image_url;
        cover.alt = story.cover_image_alt || "";
        coverFigure.hidden = false;
      } else {
        coverFigure.hidden = true;
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
      setState(state, "error", "Kisah belum dapat dimuat.", renderStoryDetail);
    }
  };

  renderHomepageStories();
  renderArchiveStories();
  renderStoryDetail();
})();
