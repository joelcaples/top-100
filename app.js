const topGrid = document.getElementById("topGrid");
const rerollBtn = document.getElementById("rerollBtn");
const statusMsg = document.getElementById("statusMsg");
const editModal = document.getElementById("editModal");
const detailModalTitle = document.getElementById("detailModalTitle");
const detailModalRank = document.getElementById("detailModalRank");
const detailModalCategory = document.getElementById("detailModalCategory");
const detailModalImage = document.getElementById("detailModalImage");
const detailModalFavoriteBtn = document.getElementById("detailModalFavoriteBtn");
const detailModalPrevImageBtn = document.getElementById("detailModalPrevImageBtn");
const detailModalNextImageBtn = document.getElementById("detailModalNextImageBtn");
const detailModalTitleInput = document.getElementById("detailModalTitleInput");
const detailModalCategoryInput = document.getElementById("detailModalCategoryInput");
const modalRefreshBtn = document.getElementById("modalRefreshBtn");
const modalImageToggleBtn = document.getElementById("modalImageToggleBtn");
const modalDeleteBtn = document.getElementById("modalDeleteBtn");
const modalSearchPanel = document.getElementById("modalSearchPanel");
const modalSearchInput = document.getElementById("modalSearchInput");
const modalSearchResults = document.getElementById("modalSearchResults");
const signInLink = document.getElementById("signInLink");
const usernameModal = document.getElementById("usernameModal");
const usernameInput = document.getElementById("usernameInput");
const usernameSetBtn = document.getElementById("usernameSetBtn");
const usernameError = document.getElementById("usernameError");
const accountMenuBtn = document.getElementById("accountMenuBtn");
const accountMenuAvatar = document.getElementById("accountMenuAvatar");
const accountMenu = document.getElementById("accountMenu");
const accountUsername = document.getElementById("accountUsername");
const accountProvider = document.getElementById("accountProvider");
const accountAvatarPreview = document.getElementById("accountAvatarPreview");
const accountAvatarInput = document.getElementById("accountAvatarInput");
const changeUsernameBtn = document.getElementById("changeUsernameBtn");
const accountLogoutLink = document.getElementById("accountLogoutLink");
const LOADING_IMAGE_SRC = "/image-loading.svg";
const imagePolls = new Map();
const modalState = {
  cell: null,
  lastFocus: null,
  isSaving: false
};
const modalViewerState = {
  entryId: null,
  images: [],
  activeIndex: 0,
  isTogglingFavorite: false
};
const reorderState = {
  draggingCell: null,
  isPersisting: false,
  hasQueuedPersist: false
};
let pendingAvatarImage = null;

function getDefaultAvatarDataUri() {
  return "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 96 96'%3E%3Crect width='96' height='96' rx='12' fill='%2317120d'/%3E%3Ccircle cx='48' cy='35' r='17' fill='%23b79354'/%3E%3Cpath d='M14 84c5-16 18-25 34-25s29 9 34 25' fill='%23b79354'/%3E%3C/svg%3E";
}

function setAccountAvatar(avatarImage) {
  const avatarSrc = typeof avatarImage === "string" && avatarImage.trim() ? avatarImage.trim() : getDefaultAvatarDataUri();

  if (accountMenuAvatar) {
    accountMenuAvatar.src = avatarSrc;
    accountMenuAvatar.hidden = false;
  }

  if (accountMenuBtn) {
    accountMenuBtn.classList.toggle("account-icon-btn--has-avatar", Boolean(avatarImage));
  }

  if (accountAvatarPreview) {
    accountAvatarPreview.src = avatarSrc;
  }
}

async function fileToAvatarDataUrl(file) {
  if (!file) {
    return null;
  }

  const rawDataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error("Failed to read selected image"));
    reader.readAsDataURL(file);
  });

  const image = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Selected file is not a valid image"));
    img.src = rawDataUrl;
  });

  const maxSize = 160;
  const canvas = document.createElement("canvas");
  canvas.width = maxSize;
  canvas.height = maxSize;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not prepare avatar image");
  }

  ctx.fillStyle = "#17120d";
  ctx.fillRect(0, 0, maxSize, maxSize);
  const scale = Math.max(maxSize / image.width, maxSize / image.height);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  const offsetX = (maxSize - drawWidth) / 2;
  const offsetY = (maxSize - drawHeight) / 2;
  ctx.drawImage(image, offsetX, offsetY, drawWidth, drawHeight);

  return canvas.toDataURL("image/jpeg", 0.85);
}

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

function getHeartButtonMarkup(isFilled = false) {
  if (isFilled) {
    return `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 21s-6.7-4.35-9.33-8.1C.13 9.34 1.37 5.1 4.9 3.77c2.13-.8 4.44-.16 5.9 1.61 1.46-1.77 3.77-2.41 5.9-1.61 3.53 1.33 4.77 5.57 2.23 9.13C18.7 16.65 12 21 12 21Z"/>
      </svg>
    `;
  }

  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M12 21s-6.7-4.35-9.33-8.1C.13 9.34 1.37 5.1 4.9 3.77c2.13-.8 4.44-.16 5.9 1.61 1.46-1.77 3.77-2.41 5.9-1.61 3.53 1.33 4.77 5.57 2.23 9.13C18.7 16.65 12 21 12 21Z"/>
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
    <span class="rank">${rank}.</span>
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

function getActiveViewerImage() {
  if (!modalViewerState.images.length) {
    return null;
  }

  return modalViewerState.images[modalViewerState.activeIndex] || null;
}

function getModalDisplayedImageUrl() {
  const imageSrc = detailModalImage?.getAttribute("src") || LOADING_IMAGE_SRC;
  return imageSrc.includes("image-loading.svg") ? LOADING_IMAGE_SRC : imageSrc;
}

function updateModalViewerControls() {
  const activeImage = getActiveViewerImage();
  const displayedImageUrl = getModalDisplayedImageUrl();
  const canNavigate = modalViewerState.images.length > 1;

  if (detailModalPrevImageBtn) {
    detailModalPrevImageBtn.disabled = !canNavigate;
    detailModalPrevImageBtn.hidden = !canNavigate;
  }
  if (detailModalNextImageBtn) {
    detailModalNextImageBtn.disabled = !canNavigate;
    detailModalNextImageBtn.hidden = !canNavigate;
  }

  if (detailModalFavoriteBtn) {
    const canToggleFavorite = Boolean(
      modalState.cell && (activeImage?.imageUrl || (displayedImageUrl && displayedImageUrl !== LOADING_IMAGE_SRC))
    );
    const displayedImage =
      modalViewerState.images.find((image) => image.imageUrl === displayedImageUrl) ||
      activeImage ||
      null;
    const isFavorite = Boolean(displayedImage?.isFavorite);
    detailModalFavoriteBtn.disabled = !canToggleFavorite || modalViewerState.isTogglingFavorite;
    detailModalFavoriteBtn.classList.toggle("detail-modal__favorite--active", isFavorite);
    detailModalFavoriteBtn.innerHTML = getHeartButtonMarkup(isFavorite);
    detailModalFavoriteBtn.setAttribute("aria-label", isFavorite ? "Remove favorite" : "Save as favorite");
    detailModalFavoriteBtn.setAttribute("title", isFavorite ? "Remove favorite" : "Save as favorite");
  }
}

function setModalImageFromViewerOrCell(cell = modalState.cell) {
  if (!detailModalImage || !cell) {
    return;
  }

  const activeImage = getActiveViewerImage();
  const fallbackSrc = getCellImageSrc(cell);
  const imageSrc = activeImage?.imageUrl || fallbackSrc;
  const title = cell.querySelector(".title")?.textContent || "item";

  detailModalImage.src = imageSrc;
  detailModalImage.alt = imageSrc === LOADING_IMAGE_SRC ? `Loading image for ${title}` : `Image for ${title}`;
  updateModalViewerControls();
}

async function loadModalViewerImages(cell = modalState.cell, preferredImageUrl = null) {
  if (!cell || !modalSearchPanel) {
    return;
  }

  const id = Number(cell.dataset.id);
  if (!Number.isInteger(id) || id < 1) {
    return;
  }

  try {
    const response = await fetch(`/api/entries/${id}/favorites`, {
      headers: { Accept: "application/json" }
    });

    if (!response.ok) {
      throw new Error(`Favorite image load failed: ${response.status}`);
    }

    const payload = await response.json();
    const currentCellImage = getCellImageSrc(cell);
    const images = Array.isArray(payload.images) ? payload.images.slice() : [];

    const currentExists = images.some((image) => image.imageUrl === payload.currentImageUrl);
    if (payload.currentImageUrl && !currentExists) {
      images.unshift({
        imageUrl: payload.currentImageUrl,
        imageSource: null,
        imageQuery: null,
        isFavorite: false,
        isCurrent: true
      });
    }

    const fallbackExists = currentCellImage && images.some((image) => image.imageUrl === currentCellImage);
    if (currentCellImage && currentCellImage !== LOADING_IMAGE_SRC && !fallbackExists) {
      images.unshift({
        imageUrl: currentCellImage,
        imageSource: null,
        imageQuery: null,
        isFavorite: false,
        isCurrent: payload.currentImageUrl === currentCellImage
      });
    }

    modalViewerState.entryId = id;
    modalViewerState.images = images;

    const preferred = preferredImageUrl && preferredImageUrl !== LOADING_IMAGE_SRC ? preferredImageUrl : null;
    const preferredIndex = preferred ? images.findIndex((image) => image.imageUrl === preferred) : -1;
    modalViewerState.activeIndex = preferredIndex >= 0 ? preferredIndex : 0;

    setModalImageFromViewerOrCell(cell);
  } catch (error) {
    console.error("Could not load favorite images:", error);
    modalViewerState.entryId = id;
    modalViewerState.images = [];
    modalViewerState.activeIndex = 0;
    setModalImageFromViewerOrCell(cell);
  }
}

async function toggleActiveImageFavorite() {
  const cell = modalState.cell;
  const activeImage = getActiveViewerImage();
  const displayedImageUrl = getModalDisplayedImageUrl();
  const fallbackImage =
    displayedImageUrl && displayedImageUrl !== LOADING_IMAGE_SRC
      ? {
          imageUrl: displayedImageUrl,
          imageSource: null,
          imageQuery: null,
          isFavorite: Boolean(
            modalViewerState.images.find((image) => image.imageUrl === displayedImageUrl)?.isFavorite
          )
        }
      : null;
  const targetImage = activeImage?.imageUrl ? activeImage : fallbackImage;

  if (modalViewerState.isTogglingFavorite) {
    return;
  }

  if (!cell || !targetImage?.imageUrl) {
    statusMsg.textContent = "Load an image first, then save it with the heart.";
    return;
  }

  modalViewerState.isTogglingFavorite = true;
  updateModalViewerControls();

  const nextFavoriteValue = !targetImage.isFavorite;
  const id = Number(cell.dataset.id);
  try {
    const response = await fetch(`/api/entries/${id}/favorites`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        imageUrl: targetImage.imageUrl,
        favorite: nextFavoriteValue,
        imageSource: targetImage.imageSource || null,
        imageQuery: targetImage.imageQuery || null
      })
    });

    if (!response.ok) {
      let message = `Favorite toggle failed: ${response.status}`;
      try {
        const errorPayload = await response.json();
        if (errorPayload?.error) {
          message = String(errorPayload.error);
        }
      } catch (_error) {
        // Ignore JSON parse failures for non-JSON responses.
      }
      throw new Error(message);
    }

    const preferredUrl = targetImage.imageUrl;
    await loadModalViewerImages(cell, preferredUrl);
    statusMsg.textContent = nextFavoriteValue
      ? "Saved image to this tile."
      : "Removed image from saved list.";
  } catch (error) {
    console.error("Could not update favorite image:", error);
    statusMsg.textContent = error?.message || "Could not update saved image.";
  } finally {
    modalViewerState.isTogglingFavorite = false;
    updateModalViewerControls();
  }
}

function navigateModalViewer(direction) {
  if (modalViewerState.images.length <= 1) {
    return;
  }

  const offset = direction === "prev" ? -1 : 1;
  const total = modalViewerState.images.length;
  modalViewerState.activeIndex = (modalViewerState.activeIndex + offset + total) % total;
  setModalImageFromViewerOrCell(modalState.cell);
  
  // Update cell's main image to match the modal viewer image
  const activeImage = getActiveViewerImage();
  if (activeImage && modalState.cell) {
    showImageMode(modalState.cell, activeImage.imageUrl);
  }
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

  detailModalTitle.textContent = title;
  detailModalRank.textContent = rank;
  detailModalCategory.textContent = category;
  setModalImageFromViewerOrCell(cell);
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
      const tags = cell.querySelector(".tag")?.textContent?.trim() || "";
      modalSearchInput.value = [name, tags].filter(Boolean).join(" ").trim();
    }
    if (modalSearchResults) {
      modalSearchResults.innerHTML = "";
    }

  syncEditModalFromCell(cell);
  loadModalViewerImages(cell, getCellImageSrc(cell));
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
  modalViewerState.entryId = null;
  modalViewerState.images = [];
  modalViewerState.activeIndex = 0;
  modalViewerState.isTogglingFavorite = false;
  updateModalViewerControls();

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
          if (modalState.cell === cell) {
            loadModalViewerImages(cell, payload.imageUrl);
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
      if (modalState.cell === cell) {
        loadModalViewerImages(cell, payload.imageUrl);
      }
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
  // Use local loading image while server caches the selected remote image.
  showImageMode(cell, LOADING_IMAGE_SRC);

  try {
    const response = await fetch(`/api/entries/${id}/image/pick`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ fetchUrl, thumbnailUrl, sourceUrl, query })
    });

    if (!response.ok) {
      let errorMessage = `Pick failed: ${response.status}`;
      try {
        const errorPayload = await response.json();
        if (errorPayload?.error) {
          errorMessage = `Pick failed: ${response.status} (${errorPayload.error})`;
        }
      } catch {
        // Ignore parse errors and fall back to status-only message.
      }
      throw new Error(errorMessage);
    }

    const payload = await response.json();
    if (payload.imageUrl) {
      showImageMode(cell, payload.imageUrl);
      if (modalState.cell === cell) {
        loadModalViewerImages(cell, payload.imageUrl);
      }
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
      <input class="add-category" type="text" placeholder="Tags" maxlength="80" />
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

      // New entries should begin in image mode immediately.
      ensureEntryImage(newCell).catch((error) => {
        console.error("Could not initialize image mode for new entry:", error);
      });

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

    if (response.status === 401) {
      statusMsg.textContent = "Sign in to load your personal board.";
      topGrid.innerHTML = "";
      return;
    }

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

if (detailModalFavoriteBtn) {
  detailModalFavoriteBtn.innerHTML = getHeartButtonMarkup(false);
  detailModalFavoriteBtn.addEventListener("click", async () => {
    await toggleActiveImageFavorite();
  });
}

if (detailModalPrevImageBtn) {
  detailModalPrevImageBtn.addEventListener("click", () => {
    navigateModalViewer("prev");
  });
}

if (detailModalNextImageBtn) {
  detailModalNextImageBtn.addEventListener("click", () => {
    navigateModalViewer("next");
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

// PWA install prompt disabled

if (rerollBtn) {
  rerollBtn.addEventListener("click", fetchListflair);
}

registerServiceWorker();

function showUsernameModal() {
  if (!usernameModal) return;
  usernameModal.hidden = false;
  document.body.classList.add("modal-open");
  if (usernameInput) {
    usernameInput.value = "";
    usernameInput.focus();
  }
  if (usernameError) {
    usernameError.textContent = "";
    usernameError.style.display = "none";
  }
}

function closeUsernameModal() {
  if (!usernameModal) return;
  usernameModal.hidden = true;
  document.body.classList.remove("modal-open");
}

if (usernameModal) {
  usernameModal.addEventListener("click", (event) => {
    if (event.target.closest("[data-username-close]")) {
      closeUsernameModal();
    }
  });
}

async function handleSetUsername() {
  if (!usernameInput || !usernameSetBtn) return;

  const username = usernameInput.value.trim();
  if (!username) {
    if (usernameError) {
      usernameError.textContent = "Username cannot be empty";
      usernameError.style.display = "block";
    }
    return;
  }

  usernameSetBtn.disabled = true;
  if (usernameError) {
    usernameError.textContent = "";
    usernameError.style.display = "none";
  }

  try {
    const response = await fetch("/api/user", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ username })
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || "Failed to set username");
    }

    closeUsernameModal();
    if (accountUsername) {
      accountUsername.textContent = username;
    }
    await fetchListflair();
  } catch (error) {
    console.error("Could not set username:", error);
    if (usernameError) {
      usernameError.textContent = error.message || "Could not set username. Try another.";
      usernameError.style.display = "block";
    }
  } finally {
    usernameSetBtn.disabled = false;
  }
}

if (usernameSetBtn) {
  usernameSetBtn.addEventListener("click", handleSetUsername);
}

if (usernameInput) {
  usernameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSetUsername();
    }
  });
}

function showAccountMenu() {
  if (!accountMenu) return;
  accountMenu.hidden = false;
  if (accountMenuBtn) {
    accountMenuBtn.setAttribute("aria-expanded", "true");
  }
}

function closeAccountMenu() {
  if (!accountMenu) return;
  accountMenu.hidden = true;
  if (accountMenuBtn) {
    accountMenuBtn.setAttribute("aria-expanded", "false");
  }
}

function updateAccountMenuDisplay(userData) {
  if (accountUsername) {
    accountUsername.textContent = userData.username || "—";
  }
  if (accountProvider) {
    const provider = userData.authProvider || "unknown";
    accountProvider.textContent = provider.charAt(0).toUpperCase() + provider.slice(1);
  }
  setAccountAvatar(userData.avatarImage || null);
}

if (accountMenuBtn) {
  accountMenuBtn.addEventListener("click", showAccountMenu);
}

if (accountMenu) {
  accountMenu.addEventListener("click", (event) => {
    if (event.target.closest("[data-account-close]")) {
      closeAccountMenu();
    }
  });
}

if (changeUsernameBtn) {
  changeUsernameBtn.addEventListener("click", () => {
    closeAccountMenu();
    showUsernameModal();
  });
}

async function saveAvatar(avatarImage) {
  try {
    const response = await fetch("/api/user", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ avatarImage })
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `Failed to save avatar (${response.status})`);
    }

    const payload = await response.json();
    updateAccountMenuDisplay({
      username: payload.username,
      authProvider: accountProvider?.textContent?.trim()?.toLowerCase() || "unknown",
      avatarImage: payload.avatarImage
    });
    statusMsg.textContent = "Avatar updated.";
  } catch (error) {
    console.error("Could not save avatar:", error);
    statusMsg.textContent = error.message || "Could not save avatar.";
  }
}

if (accountAvatarInput) {
  accountAvatarInput.addEventListener("change", async () => {
    const file = accountAvatarInput.files?.[0] || null;
    if (!file) {
      return;
    }

    try {
      pendingAvatarImage = await fileToAvatarDataUrl(file);
      setAccountAvatar(pendingAvatarImage);
      statusMsg.textContent = "";
      // Auto-save avatar immediately
      await saveAvatar(pendingAvatarImage);
      pendingAvatarImage = null;
      if (accountAvatarInput) {
        accountAvatarInput.value = "";
      }
    } catch (error) {
      console.error("Could not prepare avatar image:", error);
      statusMsg.textContent = "Could not read selected avatar image.";
      pendingAvatarImage = null;
    }
  });
}

if (accountLogoutLink) {
  accountLogoutLink.addEventListener("click", (e) => {
    // Set logout flag to prevent auto-login
    sessionStorage.setItem("listflair_logging_out", "true");
    // Let the logout link navigate normally
  });
}

async function initAuth() {
  const isLocalHost =
    location.hostname === "localhost" || location.hostname === "127.0.0.1";
  let authState = { isAuthenticated: false, isLocalHost, username: null };

  // Check if we just logged out - if so, clear state and wait for fresh login
  const justLoggedOut = sessionStorage.getItem("listflair_logging_out") === "true";
  if (justLoggedOut) {
    sessionStorage.removeItem("listflair_logging_out");
    // Clear UI state on logout
    if (accountMenuBtn) accountMenuBtn.hidden = true;
    if (signInLink) signInLink.hidden = false;
    return authState;
  }

  try {
    const response = await fetch("/api/me", { headers: { Accept: "application/json" } });
    if (!response.ok) {
      return authState;
    }
    const { isAuthenticated, displayName, username, avatarImage, loginUrl, logoutUrl, authProvider } = await response.json();
    authState = { isAuthenticated: Boolean(isAuthenticated), isLocalHost, username };

    if (signInLink && loginUrl) {
      signInLink.href = loginUrl;
    }
    if (accountLogoutLink && logoutUrl) {
      accountLogoutLink.href = logoutUrl;
    }

    if (isAuthenticated) {
      if (accountMenuBtn) {
        accountMenuBtn.hidden = false;
      }
      if (signInLink) {
        signInLink.hidden = true;
      }

      updateAccountMenuDisplay({ username, authProvider, avatarImage });

      if (!username && usernameModal) {
        showUsernameModal();
      }
    } else if (!isLocalHost) {
      if (signInLink) {
        signInLink.hidden = false;
      }
      if (accountMenuBtn) {
        accountMenuBtn.hidden = true;
      }

      statusMsg.textContent = "Sign in to create and load your personal board.";
    } else {
      // Not authenticated and on localhost: show sign-in button
      if (signInLink) {
        signInLink.hidden = false;
      }
      if (accountMenuBtn) {
        accountMenuBtn.hidden = true;
      }
    }
  } catch {
    // Auth widget stays hidden on error; not critical
  }

  return authState;
}

async function bootstrapApp() {
  const { isAuthenticated, isLocalHost, username } = await initAuth();
  if (isAuthenticated && !username) {
    return;
  }
  if (isAuthenticated) {
    await fetchListflair();
    return;
  }

  // Not authenticated: show empty state
  topGrid.innerHTML = "";
  statusMsg.textContent = "Sign in to see your personal board.";
}

bootstrapApp();
