const topGrid = document.getElementById("topGrid");
const rerollBtn = document.getElementById("rerollBtn");
const statusMsg = document.getElementById("statusMsg");

function renderTop100(selection) {
  topGrid.innerHTML = selection
    .map(
      (item, index) => `
        <article class="cell" style="animation-delay:${Math.min(index * 12, 680)}ms">
          <span class="rank">#${index + 1}</span>
          <p class="title">${item.name}</p>
          <span class="tag">${item.category}</span>
        </article>
      `
    )
    .join("");
}

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
