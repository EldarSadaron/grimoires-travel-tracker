import { MODULE_ID, registerTrackerSettings } from "./settings.js";
import { WeatherEngine } from "./weather.js";

let travelTimeout = null; 

Hooks.once("init", () => { registerTrackerSettings(); });

Hooks.once("ready", () => {
    if (game.settings.get(MODULE_ID, "enableWeather")) {
        globalThis.GrimoireWeather = new WeatherEngine();
    }
    setTimeout(initTracker, 1000);
});

function initTracker() {
    const hudElement = document.getElementById("grimoire-hud");
    if (!hudElement) return;
    if (document.getElementById("travel-tracker-widget")) return;

    const travelDiv = document.createElement("div");
    travelDiv.id = "travel-tracker-widget";
    travelDiv.classList.add("hud-section", "travel-section");
    travelDiv.innerHTML = `<span class="travel-icon">⛺</span><div class="travel-data"><span class="travel-state">Resting</span><span class="travel-subtext">Weather: Stable</span></div>`;
    
    const box = hudElement.querySelector(".hud-box .hud-content");
    if (box) box.insertBefore(travelDiv, box.firstChild);
}

// --- TRAVEL LOGIC ---
Hooks.on("updateToken", (tokenDoc, changes) => {
    if ((!changes.x && !changes.y) || !game.user.isGM) return;
    const targetSceneId = game.settings.get(MODULE_ID, "worldMapScene");
    if (targetSceneId !== "all" && tokenDoc.parent.id !== targetSceneId) return;

    if (travelTimeout) clearTimeout(travelTimeout);
    travelTimeout = setTimeout(() => { runMoveLogic(tokenDoc.object); }, 1000); 
});

async function runMoveLogic(token) {
    if (!token || !token.actor) return;

    const lastX = token.document.getFlag(MODULE_ID, "lastX") || token.x;
    const lastY = token.document.getFlag(MODULE_ID, "lastY") || token.y;
    const distPixels = Math.hypot(token.x - lastX, token.y - lastY);
    
    // Debug
    console.log(`Grimoire Travel | Moved ${Math.round(distPixels)}px`);

    await token.document.setFlag(MODULE_ID, "lastX", token.x);
    await token.document.setFlag(MODULE_ID, "lastY", token.y);

    if (distPixels < canvas.grid.size) return; 

    const distMiles = (distPixels / canvas.grid.size) * canvas.scene.grid.distance;
    const speed = token.actor.system.attributes?.movement?.walk || 30;
    const mph = speed / 10;
    let rawMinutes = (distMiles / mph) * 60;
    
    const rawTerrain = getTerrainTag(token);
    const simpleTerrain = normalizeTerrain(rawTerrain);

    if (["swamp", "mountain", "snow", "dungeon"].includes(simpleTerrain)) rawMinutes *= 2;
    if (simpleTerrain === "road") rawMinutes *= 0.75;

    const minutesPassed = Math.max(10, Math.ceil(rawMinutes / 5) * 5);

    // Execute
    await game.time.advance(minutesPassed * 60);
    
    let weatherChanged = false;
    if (globalThis.GrimoireWeather) {
        weatherChanged = await globalThis.GrimoireWeather.handleTimeChange(minutesPassed);
    }

    // Visuals (Scorched Earth)
    const lastRecorded = token.document.getFlag(MODULE_ID, "lastTerrain") || "none";
    if (simpleTerrain !== lastRecorded || weatherChanged) {
        if (globalThis.GrimoireWeather) {
            await globalThis.GrimoireWeather.applyWeather(game.settings.get(MODULE_ID, "weatherState").type);
        }
        await token.document.setFlag(MODULE_ID, "lastTerrain", simpleTerrain);
    }

    updateWidget(distMiles, minutesPassed, rawTerrain);
    
    if (game.settings.get(MODULE_ID, "enableEncounters")) {
        await checkEncounter(simpleTerrain);
    }
}

// --- ENCOUNTER ENGINE ---
async function checkEncounter(terrainType) {
    if (terrainType === "safe" || terrainType === "road") return;
    const threshold = game.settings.get(MODULE_ID, "encounterChance");
    const roll = Math.floor(Math.random() * 20) + 1;

    console.log(`Grimoire Encounter | ${terrainType.toUpperCase()}: Rolled ${roll} vs ${threshold}`);

    if (roll >= threshold) {
        const tableName = `Encounters: ${capitalize(terrainType)}`;
        const table = game.tables.getName(tableName);
        const mapMatches = game.scenes.filter(s => {
            const n = s.name.toLowerCase();
            return (n.includes("battlemap") && n.includes(terrainType));
        });

        let tableBtn = table ? 
            `<button data-action="roll-table" data-table-id="${table.id}">🎲 Roll ${tableName}</button>` : 
            `<button data-action="manual-table" data-terrain="${terrainType}">🔎 Choose Table...</button>`;

        let mapBtn = mapMatches.length > 0 ? 
            `<button data-action="activate-scene" data-scene-id="${mapMatches[0].id}">📍 Load Map: ${mapMatches[0].name}</button>` : 
            `<button data-action="manual-scene" data-terrain="${terrainType}">🔎 Choose Map...</button>`;

        ChatMessage.create({
            speaker: { alias: "Grimoire Encounter" },
            content: `
                <div style="background: #1a1a1a; color: #eee; padding: 10px; border: 1px solid #a00;">
                    <h3 style="border-bottom: 2px solid #a00; margin-bottom: 8px;">⚔️ Encounter!</h3>
                    <p>Ambush in the <b>${terrainType.toUpperCase()}</b>.</p>
                    <div style="display: flex; gap: 5px; flex-direction: column;">${tableBtn}${mapBtn}</div>
                </div>
            `
        });
    }
}

// --- LISTENERS ---
Hooks.on("renderChatMessage", (app, html, data) => {
    html.find("button[data-action='activate-scene']").click(ev => {
        const scene = game.scenes.get(ev.currentTarget.dataset.sceneId);
        if (scene) scene.view();
    });
    html.find("button[data-action='roll-table']").click(ev => {
        const table = game.tables.get(ev.currentTarget.dataset.tableId);
        if (table) table.draw();
    });
    html.find("button[data-action='manual-scene']").click(ev => {
        let options = game.scenes.map(s => `<option value="${s.id}">${s.name}</option>`).join("");
        new Dialog({
            title: "Select Map",
            content: `<select id="scene-select" style="width:100%">${options}</select>`,
            buttons: { go: { label: "Load", callback: (h) => game.scenes.get(h.find("#scene-select").val())?.view() } }
        }).render(true);
    });
});

// --- HELPERS ---
function normalizeTerrain(rawName) {
    const n = rawName.toLowerCase();
    if (n.includes("swamp")) return "swamp";
    if (n.includes("mountain")) return "mountain";
    if (n.includes("snow") || n.includes("ice")) return "snow";
    if (n.includes("road")) return "road";
    return "wilderness";
}

function getTerrainTag(token) {
    if (!canvas.regions) return "wilderness";
    const point = { x: token.center.x, y: token.center.y, elevation: token.document.elevation };
    // V13 SAFE CHECK
    const region = canvas.regions.placeables.find(r => r.document && r.document.testPoint(point));
    return region ? region.document.name.toLowerCase() : "wilderness";
}

function updateWidget(miles, minutes, terrain) {
    const widget = document.getElementById("travel-tracker-widget");
    if (!widget) return;
    widget.querySelector(".travel-state").innerText = `Travel: ${capitalize(terrain)}`;
    widget.querySelector(".travel-subtext").innerText = `Last: ${miles.toFixed(1)}mi (${Math.floor(minutes/60)}h ${minutes%60}m)`;
    
    clearTimeout(window.hudResetTimer);
    window.hudResetTimer = setTimeout(() => {
        widget.querySelector(".travel-state").innerText = "Resting";
    }, 5000);
}

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }