const topGrid = document.getElementById("topGrid");
const rerollBtn = document.getElementById("rerollBtn");
const statusMsg = document.getElementById("statusMsg");
const editModal = document.getElementById("editModal");
const detailModalTitle = document.getElementById("detailModalTitle");
const detailModalRank = document.getElementById("detailModalRank");
const detailModalCategory = document.getElementById("detailModalCategory");
const detailModalImage = document.getElementById("detailModalImage");
const detailModalTitleInput = document.getElementById("detailModalTitleInput");
const detailModalCategoryInput = document.getElementById("detailModalCategoryInput");
const modalRefreshBtn = document.getElementById("modalRefreshBtn");
const modalImageToggleBtn = document.getElementById("modalImageToggleBtn");
const modalDeleteBtn = document.getElementById("modalDeleteBtn");
const modalSearchPanel = document.getElementById("modalSearchPanel");
const modalSearchInput = document.getElementById("modalSearchInput");
const modalSearchResults = document.getElementById("modalSearchResults");
const LOADING_IMAGE_SRC = "/image-loading.svg";
const imagePolls = new Map();
const modalState = {
  cell: null,
  lastFocus: null,
  isSaving: false
};
const reorderState = {
  draggingCell: null,
  isPersisting: false,
  hasQueuedPersist: false
};

const modalFocusableSelector =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getDeleteButtonMarkup() {
  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <polyline points="3 6 5 6 21 6"/>
      <path d="M19 6l-1 14H6L5 6"/>
      <path d="M10 11v6M14 11v6"/>
      <path d="M9 6V4h6v2"/>
    </svg>
  `;
}

function getEditButtonMarkup() {
  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M12 20h9"/>
      <path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4Z"/>
    </svg>
  `;
}

function getRefreshButtonMarkup() {
  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <polyline points="23 4 23 10 17 10"/>
      <polyline points="1 20 1 14 7 14"/>
      <path d="M3.5 9a9 9 0 0 1 14.13-3.36L23 10"/>
      <path d="M20.5 15a9 9 0 0 1-14.13 3.36L1 14"/>
    </svg>
  `;
}

function getSearchButtonMarkup() {
  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="8"/>
      <line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
  `;
}

function escapeAttr(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function getImageButtonMarkup(mode = "image") {
  if (mode === "text") {
    return `<span class="image-btn__text" aria-hidden="true">T</span>`;
  }

  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
      <circle cx="8.5" cy="8.5" r="1.5"/>
      <polyline points="21 15 16 10 5 21"/>
    </svg>
  `;
}

function setImageButtonMode(button, mode) {
  if (!button) {
    return;
  }

  button.innerHTML = getImageButtonMarkup(mode);
  if (mode === "text") {
    button.setAttribute("title", "Show text");
    button.setAttribute("aria-label", "Show text");
    return;
  }

  button.setAttribute("title", "Show image");
  button.setAttribute("aria-label", "Show image");
}

function setRefreshButtonLoading(cell, isLoading) {
  const refreshBtn = cell.querySelector(".refresh-btn");
  if (!refreshBtn) {
    return;
  }

  refreshBtn.disabled = isLoading;
  cell.classList.toggle("cell--image-loading", isLoading);
  syncEditModalFromCell(cell);
}

function getCellMarkup(item, rank) {
  return `
    <span class="rank">#${rank}</span>
    <p class="title">${item.name}</p>
    <span class="tag">${item.category}</span>
    <div class="cell-content">
       <img class="cell-image" style="display: none;" src="${item.imageUrl || LOADING_IMAGE_SRC}" alt="Loading" />
    </div>
    <button class="refresh-btn" aria-label="Refresh image" title="Refresh image">${getRefreshButtonMarkup()}</button>
    <button class="image-btn" aria-label="Show image" title="Show image">${getImageButtonMarkup("image")}</button>
    <button class="delete-btn" aria-label="Remove ${item.name}" title="Remove">${getDeleteButtonMarkup()}</button>
  `;
}

function getCellImageSrc(cell) {
  const imageSrc = cell.querySelector(".cell-image")?.getAttribute("src") || LOADING_IMAGE_SRC;
  return imageSrc.includes("image-loading.svg") ? LOADING_IMAGE_SRC : imageSrc;
}

function syncEditModalFromCell(cell = modalState.cell) {
  if (!cell || !editModal || editModal.hidden) {
    return;
  }

  const title = cell.querySelector(".title")?.textContent?.trim() || "Item";
  const category = cell.querySelector(".tag")?.textContent?.trim() || "General";
  const rank = cell.querySelector(".rank")?.textContent?.trim() || "";
  const isImageMode = cell.classList.contains("cell--image-mode");
  const isImageLoading = cell.classList.contains("cell--image-loading");
  const imageSrc = getCellImageSrc(cell);

  detailModalTitle.textContent = title;
  detailModalRank.textContent = rank;
  detailModalCategory.textContent = category;
  detailModalImage.src = imageSrc;
  detailModalImage.alt = imageSrc === LOADING_IMAGE_SRC ? `Loading image for ${title}` : `Image for ${title}`;
  if (detailModalTitleInput && document.activeElement !== detailModalTitleInput) {
    detailModalTitleInput.value = title;
  }
  if (detailModalCategoryInput && document.activeElement !== detailModalCategoryInput) {
    detailModalCategoryInput.value = category;
  }
  if (modalDeleteBtn) {
    modalDeleteBtn.setAttribute("aria-label", `Delete ${title}`);
    modalDeleteBtn.setAttribute("title", `Delete ${title}`);
  }
  if (modalRefreshBtn) {
    modalRefreshBtn.innerHTML = getRefreshButtonMarkup();
    modalRefreshBtn.disabled = isImageLoading;
  }
  setImageButtonMode(modalImageToggleBtn, isImageMode ? "text" : "image");
}

function getModalFocusableElements() {
  if (!editModal || editModal.hidden) {
    return [];
  }

  return Array.from(editModal.querySelectorAll(modalFocusableSelector)).filter((el) => {
    const hiddenByAttr = el.hasAttribute("hidden") || el.getAttribute("aria-hidden") === "true";
    return !hiddenByAttr && el.offsetParent !== null;
  });
}

function trapModalFocus(event) {
  if (event.key !== "Tab" || !editModal || editModal.hidden) {
    return;
  }

  const focusableElements = getModalFocusableElements();
  if (focusableElements.length === 0) {
    return;
  }

  const first = focusableElements[0];
  const last = focusableElements[focusableElements.length - 1];
  const active = document.activeElement;

  if (event.shiftKey) {
    if (active === first || !editModal.contains(active)) {
      event.preventDefault();
      last.focus();
    }
    return;
  }

  if (active === last || !editModal.contains(active)) {
    event.preventDefault();
    first.focus();
  }
}

async function saveModalDetails() {
  if (!modalState.cell || modalState.isSaving || !detailModalTitleInput || !detailModalCategoryInput) {
    return;
  }

  const cell = modalState.cell;
  const id = cell.dataset.id;
  const currentName = cell.querySelector(".title")?.textContent?.trim() || "item";
  const currentCategory = cell.querySelector(".tag")?.textContent?.trim() || "general";
  const nextName = detailModalTitleInput.value.trim();
  const nextCategory = detailModalCategoryInput.value.trim() || "general";

  if (!nextName) {
    detailModalTitleInput.value = currentName;
    detailModalTitle.textContent = currentName;
    return;
  }

  if (nextName === currentName && nextCategory === currentCategory) {
    return;
  }

  modalState.isSaving = true;

  try {
    const response = await fetch(`/api/entries/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: nextName, category: nextCategory })
    });

    if (!response.ok) {
      throw new Error(`Update failed: ${response.status}`);
    }

    const titleEl = cell.querySelector(".title");
    const tagEl = cell.querySelector(".tag");
    const deleteBtn = cell.querySelector(".delete-btn");
    const editBtn = cell.querySelector(".edit-btn");

    if (titleEl) {
      titleEl.textContent = nextName;
    }
    if (tagEl) {
      tagEl.textContent = nextCategory;
    }
    if (deleteBtn) {
      deleteBtn.setAttribute("aria-label", `Remove ${nextName}`);
    }
    if (editBtn) {
      editBtn.setAttribute("aria-label", `Open details for ${nextName}`);
    }

    syncEditModalFromCell(cell);
    statusMsg.textContent = "";
  } catch (error) {
    console.error("Could not update entry from modal:", error);
    statusMsg.textContent = "Could not save changes.";
    syncEditModalFromCell(cell);
  } finally {
    modalState.isSaving = false;
  }
}

function openEditModal(cell) {
  if (!editModal) {
    return;
  }

  modalState.cell = cell;
  modalState.lastFocus = document.activeElement;
  editModal.hidden = false;
  document.body.classList.add("modal-open");

    if (modalSearchInput) {
      const name = cell.querySelector(".title")?.textContent?.trim() || "";
      modalSearchInput.value = name;
    }
    if (modalSearchResults) {
      modalSearchResults.innerHTML = "";
    }

  syncEditModalFromCell(cell);
  if (detailModalTitleInput) {
    detailModalTitleInput.focus();
    detailModalTitleInput.setSelectionRange(0, detailModalTitleInput.value.length);
  } else {
    editModal.querySelector("[data-modal-close]")?.focus();
  }
}

function closeEditModal() {
  if (!editModal || editModal.hidden) {
    return;
  }

  editModal.hidden = true;
  document.body.classList.remove("modal-open");

  if (modalSearchInput) {
    modalSearchInput.value = "";
  }
  if (modalSearchResults) {
    modalSearchResults.innerHTML = "";
  }

  const focusTarget = modalState.lastFocus;
  modalState.cell = null;
  modalState.lastFocus = null;

  if (focusTarget && document.contains(focusTarget)) {
    focusTarget.focus();
  }
}

function showImageMode(cell, imageUrl = LOADING_IMAGE_SRC) {
  const image = cell.querySelector(".cell-image");
  const content = cell.querySelector(".cell-content");
  const imageBtn = cell.querySelector(".image-btn");
  const title = cell.querySelector(".title")?.textContent || "item";

  image.src = imageUrl;
  image.alt = imageUrl === LOADING_IMAGE_SRC ? `Loading image for ${title}` : `Image for ${title}`;
  image.style.display = "block";
  content.style.display = "flex";
  cell.classList.add("cell--image-mode");
  setImageButtonMode(imageBtn, "text");
  syncEditModalFromCell(cell);
}

function hideImageMode(cell) {
  const image = cell.querySelector(".cell-image");
  const content = cell.querySelector(".cell-content");
  const imageBtn = cell.querySelector(".image-btn");

  image.style.display = "none";
  content.style.display = "none";
  cell.classList.remove("cell--image-mode");
  setImageButtonMode(imageBtn, "image");
  syncEditModalFromCell(cell);
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function pollForImage(cell) {
  const id = cell.dataset.id;
  const fallbackSrc = cell.dataset.previousImageSrc || LOADING_IMAGE_SRC;
  if (imagePolls.has(id)) {
    return imagePolls.get(id);
  }

  const pollPromise = (async () => {
    try {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await wait(1200);

        if (!document.body.contains(cell)) {
          return;
        }

        const response = await fetch(`/api/entries/${id}/image`, {
          headers: { Accept: "application/json" }
        });

        if (!response.ok) {
          throw new Error(`Image status failed: ${response.status}`);
        }

        const payload = await response.json();
        if (payload.status === "ready" && payload.imageUrl) {
          cell.querySelector(".cell-image").src = payload.imageUrl;
          if (cell.classList.contains("cell--image-mode")) {
            showImageMode(cell, payload.imageUrl);
          }
          statusMsg.textContent = "";
          return;
        }

        if (payload.status === "error") {
          if (fallbackSrc !== LOADING_IMAGE_SRC && cell.classList.contains("cell--image-mode")) {
            showImageMode(cell, fallbackSrc);
          } else {
            hideImageMode(cell);
          }
          statusMsg.textContent = payload.error || "Could not find an image for that item.";
          return;
        }
      }

      if (fallbackSrc !== LOADING_IMAGE_SRC && cell.classList.contains("cell--image-mode")) {
        showImageMode(cell, fallbackSrc);
      } else {
        hideImageMode(cell);
      }
      statusMsg.textContent = "Image lookup took too long. Try again.";
    } finally {
      setRefreshButtonLoading(cell, false);
      imagePolls.delete(id);
    }
  })();

  imagePolls.set(id, pollPromise);
  return pollPromise;
}

async function ensureEntryImage(cell, { forceRefresh = false } = {}) {
  const id = cell.dataset.id;
  const existingSrc = cell.querySelector(".cell-image").getAttribute("src") || LOADING_IMAGE_SRC;
  const initialSrc = existingSrc.includes("image-loading.svg") ? LOADING_IMAGE_SRC : existingSrc;
  const endpoint = forceRefresh ? `/api/entries/${id}/image/refresh` : `/api/entries/${id}/image`;

  try {
    cell.dataset.previousImageSrc = initialSrc;
    setRefreshButtonLoading(cell, true);
    showImageMode(cell, forceRefresh ? LOADING_IMAGE_SRC : initialSrc);

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { Accept: "application/json" }
    });

    if (!response.ok && response.status !== 202) {
      throw new Error(`Image lookup failed: ${response.status}`);
    }

    const payload = await response.json();
    if (payload.status === "ready" && payload.imageUrl) {
      showImageMode(cell, payload.imageUrl);
      setRefreshButtonLoading(cell, false);
      statusMsg.textContent = "";
      return;
    }

    pollForImage(cell);
  } catch (error) {
    console.error("Could not load image:", error);
    setRefreshButtonLoading(cell, false);
    if (initialSrc !== LOADING_IMAGE_SRC) {
      showImageMode(cell, initialSrc);
    } else {
      hideImageMode(cell);
    }
    statusMsg.textContent = "Could not load an image for that item.";
  }
}

async function handleRefreshAction(cell) {
  if (!cell || cell.classList.contains("cell--add")) {
    return;
  }

  await ensureEntryImage(cell, { forceRefresh: true });
}

async function handleImageToggleAction(cell) {
  if (!cell || cell.classList.contains("cell--add")) {
    return;
  }

  if (cell.classList.contains("cell--image-mode")) {
    hideImageMode(cell);
    return;
  }

  await ensureEntryImage(cell);
}

async function handleDeleteAction(cell, trigger) {
  if (!cell) {
    return;
  }

  const button = trigger || cell.querySelector(".delete-btn");
  if (button) {
    button.disabled = true;
  }
  if (modalDeleteBtn && modalState.cell === cell) {
    modalDeleteBtn.disabled = true;
  }
  cell.classList.add("cell--deleting");

  try {
    const response = await fetch(`/api/entries/${cell.dataset.id}`, { method: "DELETE" });
    if (!response.ok) {
      throw new Error(`Delete failed: ${response.status}`);
    }

    if (modalState.cell === cell) {
      closeEditModal();
    }

    window.setTimeout(() => cell.remove(), 700);
  } catch (error) {
    console.error("Could not delete entry:", error);
    window.setTimeout(() => {
      cell.classList.remove("cell--deleting");
      if (button) {
        button.disabled = false;
      }
      if (modalDeleteBtn) {
        modalDeleteBtn.disabled = false;
      }
    }, 700);
  }
}


async function performImageSearch() {
  if (!modalState.cell || !modalSearchInput || !modalSearchResults) {
    return;
  }

  const q = modalSearchInput.value.trim();
  if (!q) {
    return;
  }

  const id = modalState.cell.dataset.id;
  modalSearchResults.innerHTML = '<p class="detail-modal__search-status">Searching…</p>';

  try {
    const response = await fetch(`/api/entries/${id}/image/search?q=${encodeURIComponent(q)}`, {
      headers: { Accept: "application/json" }
    });

    if (!response.ok) {
      throw new Error(`Search failed: ${response.status}`);
    }

    const { results } = await response.json();

    if (!results.length) {
      modalSearchResults.innerHTML = '<p class="detail-modal__search-status">No images found.</p>';
      return;
    }

    modalSearchResults.innerHTML = results
      .map(
        (r, i) => `
          <button
            class="detail-modal__search-thumb"
            type="button"
            data-fetch-url="${escapeAttr(r.fetchUrl)}"
            data-thumbnail-url="${escapeAttr(r.thumbnailUrl || r.fetchUrl)}"
            data-source-url="${escapeAttr(r.sourceUrl || "")}"
            data-query="${escapeAttr(q)}"
            aria-label="${escapeAttr(r.title ? r.title.slice(0, 80) : `Image result ${i + 1}`)}"
            title="${escapeAttr(r.title ? r.title.slice(0, 120) : "")}"
          >
            <img src="${escapeAttr(r.thumbnailUrl || r.fetchUrl)}" alt="" loading="lazy" />
          </button>
        `
      )
      .join("");
  } catch (err) {
    console.error("Image search failed:", err);
    modalSearchResults.innerHTML = '<p class="detail-modal__search-status">Search failed. Try again.</p>';
  }
}

async function handlePickImage(btn) {
  const cell = modalState.cell;
  if (!cell || !btn) {
    return;
  }

  const id = cell.dataset.id;
  const fetchUrl = btn.dataset.fetchUrl;
  const thumbnailUrl = btn.dataset.thumbnailUrl;
  const sourceUrl = btn.dataset.sourceUrl;
  const query = btn.dataset.query || "";
  const previousSrc = getCellImageSrc(cell);

  const thumbs = modalSearchResults?.querySelectorAll(".detail-modal__search-thumb");
  thumbs?.forEach((t) => {
    t.disabled = true;
  });
  btn.classList.add("detail-modal__search-thumb--loading");
  // Show the selected candidate immediately so the modal reflects the user's choice.
  showImageMode(cell, fetchUrl || thumbnailUrl || LOADING_IMAGE_SRC);

  try {
    const response = await fetch(`/api/entries/${id}/image/pick`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ fetchUrl, thumbnailUrl, sourceUrl, query })
    });

    if (!response.ok) {
      throw new Error(`Pick failed: ${response.status}`);
    }

    const payload = await response.json();
    if (payload.imageUrl) {
      showImageMode(cell, payload.imageUrl);
    }
    statusMsg.textContent = "";
  } catch (err) {
    console.error("Could not pick image:", err);
    statusMsg.textContent = "Could not use that image. Try another.";
    if (previousSrc && previousSrc !== LOADING_IMAGE_SRC) {
      showImageMode(cell, previousSrc);
    } else {
      hideImageMode(cell);
    }
  } finally {
    thumbs?.forEach((t) => {
      t.disabled = false;
    });
    btn.classList.remove("detail-modal__search-thumb--loading");
  }
}

function getOrderedIdsFromGrid() {
  return Array.from(topGrid.querySelectorAll(".cell[data-id]:not(.cell--add)"))
    .map((cell) => Number(cell.dataset.id))
    .filter((id) => Number.isInteger(id) && id > 0);
}

async function persistEntryOrder() {
  const orderedIds = getOrderedIdsFromGrid();
  if (orderedIds.length === 0) {
    return;
  }

  if (reorderState.isPersisting) {
    reorderState.hasQueuedPersist = true;
    return;
  }

  reorderState.isPersisting = true;
  do {
    reorderState.hasQueuedPersist = false;
    try {
      const response = await fetch("/api/entries/reorder", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({ orderedIds: getOrderedIdsFromGrid() })
      });

      if (!response.ok) {
        throw new Error(`Reorder failed: ${response.status}`);
      }

      statusMsg.textContent = "";
    } catch (error) {
      console.error("Could not save reordered list:", error);
      statusMsg.textContent = "Could not save list order. Reloading list.";
      await fetchListflair();
      break;
    }
  } while (reorderState.hasQueuedPersist);

  reorderState.isPersisting = false;
}

function clearDraggingState() {
  const draggingCell = topGrid.querySelector(".cell--dragging");
  if (draggingCell) {
    draggingCell.classList.remove("cell--dragging");
  }
  reorderState.draggingCell = null;
}

function renderListflair(selection, totalEntries) {
  closeEditModal();
  topGrid.innerHTML = selection
    .map(
      (item, index) => `
        <article class="cell" data-id="${item.id}" draggable="true" style="animation-delay:${Math.min(index * 12, 680)}ms">
          ${getCellMarkup(item, index + 1)}
        </article>
      `
    )
    .join("");

  selection.forEach((item) => {
    if (item.imageStatus === "ready" && item.imageUrl) {
      const cell = topGrid.querySelector(`.cell[data-id="${item.id}"]`);
      if (cell) {
        showImageMode(cell, item.imageUrl);
      }
    }
  });

  if (totalEntries < 100) {
    renderAddCell();
  }
}

function renderAddCell() {
  const addCell = document.createElement("article");
  addCell.className = "cell cell--add";
  addCell.innerHTML = `
    <button class="add-plus" aria-label="Add new item" title="Add item">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <line x1="12" y1="5" x2="12" y2="19"/>
        <line x1="5" y1="12" x2="19" y2="12"/>
      </svg>
    </button>
    <div class="add-form">
      <input class="add-name" type="text" placeholder="Item name" maxlength="200" />
      <input class="add-category" type="text" placeholder="Category" maxlength="80" />
    </div>
  `;

  const nameInput = addCell.querySelector(".add-name");
  const categoryInput = addCell.querySelector(".add-category");

  let saving = false;

  function hasPrintable(str) {
    return /\S/.test(str);
  }

  function enterEditMode() {
    addCell.classList.add("is-editing");
    nameInput.focus();
  }

  function collapseIfEmpty() {
    if (!hasPrintable(nameInput.value) && !hasPrintable(categoryInput.value)) {
      addCell.classList.remove("is-editing");
    }
  }

  async function commitEntry() {
    if (saving) return;
    const name = nameInput.value.trim();
    const category = categoryInput.value.trim() || "general";
    if (!hasPrintable(name)) return;
    saving = true;
    try {
      const response = await fetch("/api/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ name, category })
      });
      if (!response.ok) throw new Error(`Save failed: ${response.status}`);
      const newEntry = await response.json();

      // Insert the new cell before the add cell
      const newCell = document.createElement("article");
      newCell.className = "cell";
      let index = 1; // placeholder rank; ideally this is the position in grid
      const childCount = topGrid.children.length;
      if (childCount > 0 && topGrid.children[childCount - 1].classList.contains("cell--add")) {
        index = childCount; // Insert before the add cell
      } else {
        index = childCount + 1;
      }
      newCell.innerHTML = getCellMarkup(newEntry, index);
      newCell.dataset.id = newEntry.id;
      newCell.draggable = true;
      topGrid.insertBefore(newCell, addCell);

      // Check if we've hit 100 items
      const countRes = await fetch("/api/listflair?size=1");
      const countPayload = await countRes.json();
      if (countPayload.totalEntries >= 100) {
        addCell.remove();
      } else {
        // Clear inputs and refocus
        nameInput.value = "";
        categoryInput.value = "";
        nameInput.focus();
        saving = false;
      }
    } catch (err) {
      console.error("Could not add entry:", err);
      saving = false;
    }
  }

  addCell.addEventListener("mouseenter", enterEditMode);

  addCell.addEventListener("mouseleave", () => {
    if (document.activeElement === nameInput || document.activeElement === categoryInput) return;
    collapseIfEmpty();
  });

  // Blur on either field → commit if printable name exists, else collapse
  nameInput.addEventListener("blur", () => {
    setTimeout(() => {
      if (document.activeElement === categoryInput) return;
      if (hasPrintable(nameInput.value)) {
        commitEntry();
      } else {
        collapseIfEmpty();
      }
    }, 150);
  });

  categoryInput.addEventListener("blur", () => {
    setTimeout(() => {
      if (document.activeElement === nameInput) return;
      if (hasPrintable(nameInput.value)) {
        commitEntry();
      } else {
        collapseIfEmpty();
      }
    }, 150);
  });

  [nameInput, categoryInput].forEach((input) => {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        nameInput.value = "";
        categoryInput.value = "";
        addCell.classList.remove("is-editing");
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        commitEntry();
      }
    });
  });

  topGrid.appendChild(addCell);
}

topGrid.addEventListener("click", async (event) => {
  const cell = event.target.closest(".cell");
  if (!cell || cell.classList.contains("cell--add")) {
    return;
  }

  const refreshBtn = event.target.closest(".refresh-btn");
  if (refreshBtn) {
    await handleRefreshAction(cell);
    return;
  }

  const imageBtn = event.target.closest(".image-btn");
  if (imageBtn) {
    await handleImageToggleAction(cell);
    return;
  }

  const deleteBtn = event.target.closest(".delete-btn");
  if (deleteBtn) {
    await handleDeleteAction(cell, deleteBtn);
    return;
  }

  openEditModal(cell);
});

topGrid.addEventListener("dragstart", (event) => {
  const cell = event.target.closest(".cell");
  if (!cell || cell.classList.contains("cell--add")) {
    return;
  }

  reorderState.draggingCell = cell;
  cell.classList.add("cell--dragging");
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", cell.dataset.id || "");
  }
});

topGrid.addEventListener("dragover", (event) => {
  const draggingCell = reorderState.draggingCell;
  if (!draggingCell) {
    return;
  }

  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = "move";
  }

  const targetCell = event.target.closest(".cell");
  if (!targetCell || targetCell === draggingCell || targetCell.classList.contains("cell--add")) {
    return;
  }

  const targetRect = targetCell.getBoundingClientRect();
  const shouldInsertBefore = event.clientY < targetRect.top + targetRect.height / 2;

  if (shouldInsertBefore) {
    topGrid.insertBefore(draggingCell, targetCell);
  } else {
    topGrid.insertBefore(draggingCell, targetCell.nextSibling);
  }
});

topGrid.addEventListener("drop", async (event) => {
  if (!reorderState.draggingCell) {
    return;
  }

  event.preventDefault();
  clearDraggingState();
  await persistEntryOrder();
});

topGrid.addEventListener("dragend", () => {
  clearDraggingState();
});

if (editModal) {
  editModal.addEventListener("click", (event) => {
    if (event.target.closest("[data-modal-close]")) {
      closeEditModal();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !editModal.hidden) {
      closeEditModal();
      return;
    }

    trapModalFocus(event);
  });
}

async function fetchListflair() {
  if (rerollBtn) {
    rerollBtn.disabled = true;
  }
  statusMsg.textContent = "Loading fresh picks...";

  try {
    const response = await fetch("/api/listflair?size=100", {
      headers: {
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    const payload = await response.json();
    renderListflair(payload.items, payload.totalEntries);
    statusMsg.textContent = `Loaded ${payload.count} picks.`;
  } catch (error) {
    console.error("Unable to fetch listflair:", error);
    statusMsg.textContent = "Could not load data. Check the service and try again.";
    topGrid.innerHTML = "";
  } finally {
    if (rerollBtn) {
      rerollBtn.disabled = false;
    }
  }
}

const installBtn = document.getElementById("installBtn");
let deferredInstallPrompt;

if (modalRefreshBtn) {
  modalRefreshBtn.innerHTML = getRefreshButtonMarkup();
  modalRefreshBtn.addEventListener("click", async () => {
    await handleRefreshAction(modalState.cell);
  });
}

if (modalImageToggleBtn) {
  setImageButtonMode(modalImageToggleBtn, "image");
  modalImageToggleBtn.addEventListener("click", async () => {
    await handleImageToggleAction(modalState.cell);
  });
}

if (modalDeleteBtn) {
  modalDeleteBtn.innerHTML = getDeleteButtonMarkup();
  modalDeleteBtn.addEventListener("click", async () => {
    await handleDeleteAction(modalState.cell, modalDeleteBtn);
  });
}


if (modalSearchInput) {
  modalSearchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      performImageSearch();
    }
  });
}

const modalSearchSubmit = document.getElementById("modalSearchSubmit");
if (modalSearchSubmit) {
  modalSearchSubmit.addEventListener("click", performImageSearch);
}

if (modalSearchResults) {
  modalSearchResults.addEventListener("click", (event) => {
    const thumb = event.target.closest(".detail-modal__search-thumb");
    if (thumb && !thumb.disabled) {
      handlePickImage(thumb);
    }
  });
}

if (detailModalTitleInput) {
  detailModalTitleInput.addEventListener("input", () => {
    const preview = detailModalTitleInput.value.trim();
    detailModalTitle.textContent = preview || "Item";
  });

  detailModalTitleInput.addEventListener("blur", () => {
    saveModalDetails();
  });

  detailModalTitleInput.addEventListener("keydown", async (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      await saveModalDetails();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      syncEditModalFromCell(modalState.cell);
      detailModalTitleInput.setSelectionRange(0, detailModalTitleInput.value.length);
    }
  });
}

if (detailModalCategoryInput) {
  detailModalCategoryInput.addEventListener("input", () => {
    const preview = detailModalCategoryInput.value.trim();
    detailModalCategory.textContent = preview || "General";
  });

  detailModalCategoryInput.addEventListener("blur", () => {
    saveModalDetails();
  });

  detailModalCategoryInput.addEventListener("keydown", async (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      await saveModalDetails();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      syncEditModalFromCell(modalState.cell);
      detailModalCategoryInput.setSelectionRange(0, detailModalCategoryInput.value.length);
    }
  });
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  try {
    await navigator.serviceWorker.register("/service-worker.js");
  } catch (error) {
    console.error("Service worker registration failed:", error);
  }
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;

  if (installBtn) {
    installBtn.hidden = false;
  }
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;

  if (installBtn) {
    installBtn.hidden = true;
  }
});

if (installBtn) {
  installBtn.addEventListener("click", async () => {
    if (!deferredInstallPrompt) {
      return;
    }

    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    installBtn.hidden = true;
  });
}

if (rerollBtn) {
  rerollBtn.addEventListener("click", fetchListflair);
}

registerServiceWorker();
fetchListflair();
