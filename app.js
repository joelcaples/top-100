const topGrid = document.getElementById("topGrid");
const rerollBtn = document.getElementById("rerollBtn");
const statusMsg = document.getElementById("statusMsg");

function renderTop100(selection, totalEntries) {
  topGrid.innerHTML = selection
    .map(
      (item, index) => `
        <article class="cell" data-id="${item.id}" style="animation-delay:${Math.min(index * 12, 680)}ms">
          <span class="rank">#${index + 1}</span>
          <p class="title">${item.name}</p>
          <span class="tag">${item.category}</span>
          <button class="delete-btn" aria-label="Remove ${item.name}" title="Remove">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14H6L5 6"/>
              <path d="M10 11v6M14 11v6"/>
              <path d="M9 6V4h6v2"/>
            </svg>
          </button>
        </article>
      `
    )
    .join("");

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
      newCell.innerHTML = `
        <span class="rank">#${index}</span>
        <p class="title">${newEntry.name}</p>
        <span class="tag">${newEntry.category}</span>
        <button class="delete-btn" aria-label="Remove ${newEntry.name}" title="Remove">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14H6L5 6"/>
            <path d="M10 11v6M14 11v6"/>
            <path d="M9 6V4h6v2"/>
          </svg>
        </button>
      `;
      newCell.dataset.id = newEntry.id;
      topGrid.insertBefore(newCell, addCell);

      // Check if we've hit 100 items
      const countRes = await fetch("/api/top-100?size=1");
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
  // Handle title editing
  const titleEl = event.target.closest(".title");
  if (titleEl && !titleEl.querySelector("input")) {
    const cell = titleEl.closest(".cell");
    if (cell && !cell.classList.contains("cell--add")) {
      const id = cell.dataset.id;
      const currentName = titleEl.textContent;
      
      const input = document.createElement("input");
      input.type = "text";
      input.value = currentName;
      input.maxLength = "200";
      input.style.width = "100%";
      input.style.padding = "0.25rem";
      input.style.fontFamily = "inherit";
      input.style.fontSize = "inherit";
      
      titleEl.replaceWith(input);
      input.focus();
      input.setSelectionRange(0, input.value.length);
      requestAnimationFrame(() => {
        input.scrollLeft = 0;
      });
      
      async function saveChange() {
        const newName = input.value.trim();
        if (!newName) {
          const p = document.createElement("p");
          p.className = "title";
          p.textContent = currentName;
          input.replaceWith(p);
          return;
        }
        
        try {
          const categoryTag = cell.querySelector(".tag");
          const category = categoryTag.textContent || "general";
          const response = await fetch(`/api/entries/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: newName, category })
          });
          if (!response.ok) throw new Error(`Update failed: ${response.status}`);
          
          const p = document.createElement("p");
          p.className = "title";
          p.textContent = newName;
          input.replaceWith(p);
        } catch (err) {
          console.error("Could not update entry:", err);
          const p = document.createElement("p");
          p.className = "title";
          p.textContent = currentName;
          input.replaceWith(p);
        }
      }
      
      input.addEventListener("blur", saveChange);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          saveChange();
        } else if (e.key === "Escape") {
          const p = document.createElement("p");
          p.className = "title";
          p.textContent = currentName;
          input.replaceWith(p);
        }
      });
      return;
    }
  }

  // Handle delete button
  const btn = event.target.closest(".delete-btn");
  if (!btn) return;
  const cell = btn.closest(".cell");
  if (!cell) return;

  const id = cell.dataset.id;
  btn.disabled = true;
  cell.classList.add("cell--deleting");

  try {
    const response = await fetch(`/api/entries/${id}`, { method: "DELETE" });
    if (!response.ok) throw new Error(`Delete failed: ${response.status}`);
    setTimeout(() => cell.remove(), 700);
  } catch (err) {
    console.error("Could not delete entry:", err);
    setTimeout(() => {
      cell.classList.remove("cell--deleting");
      btn.disabled = false;
    }, 700);
  }
});

async function fetchTop100() {
  rerollBtn.disabled = true;
  statusMsg.textContent = "Loading fresh picks...";

  try {
    const response = await fetch("/api/top-100?size=100", {
      headers: {
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    const payload = await response.json();
    renderTop100(payload.items, payload.totalEntries);
    statusMsg.textContent = `Loaded ${payload.count} picks.`;
  } catch (error) {
    console.error("Unable to fetch top 100:", error);
    statusMsg.textContent = "Could not load data. Check the service and try again.";
    topGrid.innerHTML = "";
  } finally {
    rerollBtn.disabled = false;
  }
}

rerollBtn.addEventListener("click", fetchTop100);

fetchTop100();
