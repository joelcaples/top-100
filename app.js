const topGrid = document.getElementById("topGrid");
const rerollBtn = document.getElementById("rerollBtn");
const statusMsg = document.getElementById("statusMsg");

function renderTop100(selection) {
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
}

topGrid.addEventListener("click", async (event) => {
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
    renderTop100(payload.items);
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
