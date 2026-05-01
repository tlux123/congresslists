const pageLoader = document.getElementById("pageLoader");
const listsGrid = document.getElementById("listsGrid");
const listNav = document.getElementById("listNav");
const panelTemplate = document.getElementById("panelTemplate");
const cardTemplate = document.getElementById("cardTemplate");

const WIKIPEDIA_TITLE_OVERRIDES = {
  "Alexandria Ocasio-Cortez": "Alexandria_Ocasio-Cortez",
  "Donald Payne Jr.": "Donald_Payne_Jr.",
  "Hakeem Jeffries": "Hakeem_Jeffries",
  "Jim Justice": "Jim_Justice",
  "Markwayne Mullin": "Markwayne_Mullin",
  "Rob Bresnahan Jr.": "Rob_Bresnahan",
  "Sarah McBride": "Sarah_McBride",
};

const wikipediaPhotoCache = new Map();

function getWikipediaTitle(name) {
  return (
    WIKIPEDIA_TITLE_OVERRIDES[name] ||
    String(name || "")
      .replace(/\./g, "")
      .trim()
      .replace(/\s+/g, "_")
  );
}

function getCachedWikipediaPhoto(title) {
  if (wikipediaPhotoCache.has(title)) {
    return wikipediaPhotoCache.get(title);
  }

  try {
    const stored = window.localStorage.getItem(`wiki-photo:${title}`);
    if (stored) {
      wikipediaPhotoCache.set(title, stored);
      return stored;
    }
  } catch (_error) {
  }

  return null;
}

function setCachedWikipediaPhoto(title, url) {
  wikipediaPhotoCache.set(title, url);

  try {
    window.localStorage.setItem(`wiki-photo:${title}`, url);
  } catch (_error) {
  }
}

async function loadWikipediaPhoto(name) {
  const title = getWikipediaTitle(name);
  const cached = getCachedWikipediaPhoto(title);
  if (cached) {
    return cached;
  }

  const response = await fetch(
    `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`
  );

  if (!response.ok) {
    throw new Error(`Wikipedia ${response.status}`);
  }

  const payload = await response.json();
  const url = payload?.thumbnail?.source || null;
  if (url) {
    setCachedWikipediaPhoto(title, url);
  }
  return url;
}

function attachFallbackPhoto(image, name) {
  loadWikipediaPhoto(name)
    .then((url) => {
      if (!url) {
        return;
      }

      image.src = url;
      image.alt = name;
      image.classList.remove("is-empty");
    })
    .catch(() => {
    });
}

function renderCard(item) {
  const fragment = cardTemplate.content.cloneNode(true);
  fragment.querySelector(".rank-pill").textContent = item.rank;

  const image = fragment.querySelector("img");
  if (item.noPhoto) {
    image.remove();
  } else if (item.photoUrl) {
    image.src = item.photoUrl;
    image.alt = item.name;
  } else {
    image.removeAttribute("src");
    image.alt = "";
    image.classList.add("is-empty");
    attachFallbackPhoto(image, item.name);
  }

  fragment.querySelector("h3").textContent = item.name;
  fragment.querySelector(".person-meta").textContent = item.meta || "";
  fragment.querySelector(".person-stat").textContent = item.stat || "";
  fragment.querySelector(".person-market").textContent = item.market || item.summary || "";

  return fragment;
}

function renderPanel(sectionData, index) {
  const fragment = panelTemplate.content.cloneNode(true);
  const section = fragment.querySelector(".list-panel");
  section.id = sectionData.key;
  section.style.animationDelay = `${Math.min(index * 70, 560)}ms`;
  fragment.querySelector(".eyebrow").textContent = sectionData.eyebrow;
  fragment.querySelector("h2").textContent = sectionData.title;

  const list = fragment.querySelector(".panel-list");
  if (sectionData.textLayout) {
    list.classList.add("panel-list--text");
  }
  sectionData.items.forEach((item) => {
    list.appendChild(renderCard(item));
  });

  return fragment;
}

function setActiveNav(sectionKey) {
  listNav.querySelectorAll("a").forEach((link) => {
    link.classList.toggle("is-active", link.dataset.section === sectionKey);
  });

  listsGrid.querySelectorAll(".list-panel").forEach((panel) => {
    panel.classList.toggle("is-focused", panel.id === sectionKey);
  });
}

function scrollToSection(sectionKey) {
  const section = document.getElementById(sectionKey);
  if (!section) {
    return;
  }

  section.scrollIntoView({ behavior: "smooth", block: "start" });
  setActiveNav(sectionKey);
}

function renderNav(sections) {
  listNav.innerHTML = "";

  sections.forEach((section, index) => {
    const link = document.createElement("a");
    link.href = `#${section.key}`;
    link.dataset.section = section.key;
    link.innerHTML = `
      <span class="nav-index">Room ${String(index + 1).padStart(2, "0")}</span>
      <span class="nav-title">${section.title}</span>
    `;
    link.addEventListener("click", (event) => {
      event.preventDefault();
      scrollToSection(section.key);
      window.history.replaceState(null, "", `#${section.key}`);
    });
    listNav.appendChild(link);
  });
}

function activateSectionFromHash(sections) {
  const availableKeys = new Set(sections.map((section) => section.key));
  const hash = window.location.hash.replace(/^#/, "");
  const targetKey = availableKeys.has(hash) ? hash : sections[0]?.key;
  if (!targetKey) {
    return;
  }

  requestAnimationFrame(() => {
    setActiveNav(targetKey);
    if (hash) {
      scrollToSection(targetKey);
    }
  });
}

function finishLoading() {
  document.body.classList.remove("is-loading");
  document.body.classList.add("is-ready");
  if (pageLoader) {
    pageLoader.setAttribute("aria-hidden", "true");
  }
}

async function init() {
  const response = await fetch("/api/lists");
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Failed to load list data");
  }

  listsGrid.innerHTML = "";
  renderNav(payload.sections || []);

  (payload.sections || []).forEach((sectionData, index) => {
    listsGrid.appendChild(renderPanel(sectionData, index));
  });

  activateSectionFromHash(payload.sections || []);
  window.setTimeout(finishLoading, 520);
}

window.addEventListener("hashchange", () => {
  const key = window.location.hash.replace(/^#/, "");
  if (key) {
    setActiveNav(key);
  }
});

init().catch((error) => {
  listsGrid.innerHTML = `<section class="list-panel"><h2>Load error</h2><p>${error.message}</p></section>`;
  finishLoading();
});
