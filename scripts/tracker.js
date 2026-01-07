import { MODULE_ID, registerTrackerSettings } from "./settings.js";
import { WeatherEngine } from "./weather.js";

let travelTimeout = null; 

Hooks.once("init", () => {
    registerTrackerSettings();
});

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
    
    travelDiv.innerHTML = `
        <span class="travel-icon">⛺</span>
        <div class="travel-data">
            <span class="travel-state">Resting</span>
            <span class="travel-subtext">Weather: Stable</span>
        </div>
    `;

    const box = hudElement.querySelector(".hud-box .hud-content");
    if (box) box.insertBefore(travelDiv, box.firstChild);
}

// --- TRAVEL LOGIC ---
Hooks.on("updateToken", (tokenDoc, changes) => {
    if ((!changes.x && !changes.y) || !game.user.isGM) return;

    const targetSceneId = game.settings.get(MODULE_ID, "worldMapScene");
    if (targetSceneId !== "all" && tokenDoc.parent.id !== targetSceneId) return;

    if (travelTimeout) clearTimeout(travelTimeout);
    
    travelTimeout = setTimeout(() => {
        runMoveLogic(tokenDoc.object);
        travelTimeout = null;
    }, 1000); 
});

async function runMoveLogic(token) {
    if (!token || !token.actor) return;

    // 1. Distance Math
    const lastX = token.document.getFlag(MODULE_ID, "lastX") || token.x;
    const lastY = token.document.getFlag(MODULE_ID, "lastY") || token.y;
    const distPixels = Math.hypot(token.x - lastX, token.y - lastY);
    
    if (distPixels < canvas.grid.size) return;

    await token.document.setFlag(MODULE_ID, "lastX", token.x);
    await token.document.setFlag(MODULE_ID, "lastY", token.y);

    const distMiles = (distPixels / canvas.scene.grid.size) * canvas.scene.grid.distance;
    const speed = getPartySpeed(token); 
    const mph = speed / 10; 
    let rawMinutes = (distMiles / mph) * 60;
    
    // 2. Terrain Detection
    const rawTerrain = getTerrainTag(token); 
    const simpleTerrain = normalizeTerrain(rawTerrain); 

    // 3. Modifiers
    if (["swamp", "mountain", "jungle", "snow", "cave", "dungeon"].includes(simpleTerrain)) {
        rawMinutes *= 2; 
    } else if (simpleTerrain === "road") {
        rawMinutes *= 0.75; 
    }

    const minutesPassed = Math.max(10, Math.ceil(rawMinutes / 10) * 10);

    // 4. Execution
    if (distMiles > 0.1) {
        await game.time.advance(minutesPassed * 60);
        
        let weatherChanged = false;
        if (globalThis.GrimoireWeather) {
            weatherChanged = await globalThis.GrimoireWeather.handleTimeChange(minutesPassed);
        }
        
        const lastRecorded = token.document.getFlag(MODULE_ID, "lastTerrain") || "none";
        if (simpleTerrain !== lastRecorded || weatherChanged) {
            if (globalThis.GrimoireWeather) {
                await globalThis.GrimoireWeather.applyWeather(game.settings.get(MODULE_ID, "weatherState").type);
            }
            await token.document.setFlag(MODULE_ID, "lastTerrain", simpleTerrain);
        }

        updateWidget(distMiles, minutesPassed, simpleTerrain);
        
        if (game.settings.get(MODULE_ID, "enableEncounters")) {
            await checkEncounter(simpleTerrain);
        }
    }
}

// --- ENCOUNTER ENGINE (Fail-Safe Edition) ---
async function checkEncounter(terrainType) {
    if (terrainType === "safe" || terrainType === "road") return;

    const threshold = game.settings.get(MODULE_ID, "encounterChance");
    const roll = Math.floor(Math.random() * 20) + 1;

    console.log(`Grimoire Tracker | Encounter Check (${terrainType}): Rolled ${roll} vs ${threshold}`);

    if (roll >= threshold) {
        // A. SMART SEARCH
        // 1. Look for matching Tables
        const tableName = `Encounters: ${capitalize(terrainType)}`;
        const table = game.tables.getName(tableName);

        // 2. Look for matching Maps (Name or Folder)
        const mapMatches = game.scenes.filter(s => {
            const n = s.name.toLowerCase();
            const f = s.folder?.name?.toLowerCase() || "";
            return (n.includes("battlemap") && n.includes(terrainType)) || (f.includes(terrainType) && f.includes("battle"));
        });

        // B. BUTTON LOGIC
        let tableBtn = "";
        if (table) {
            tableBtn = `<button data-action="roll-table" data-table-id="${table.id}">🎲 Roll ${tableName}</button>`;
        } else {
            // FALLBACK: Manual Select Button
            tableBtn = `<button data-action="manual-table" data-terrain="${terrainType}">🔎 Choose Table...</button>`;
        }

        let mapBtn = "";
        if (mapMatches.length > 0) {
            const randomMap = mapMatches[Math.floor(Math.random() * mapMatches.length)];
            mapBtn = `<button data-action="activate-scene" data-scene-id="${randomMap.id}">📍 Load Map: ${randomMap.name}</button>`;
        } else {
            // FALLBACK: Manual Select Button
            mapBtn = `<button data-action="manual-scene" data-terrain="${terrainType}">🔎 Choose Map...</button>`;
        }

        // C. RENDER CHAT CARD
        ChatMessage.create({
            speaker: { alias: "Grimoire Encounter" },
            content: `
                <div style="background: #1a1a1a; color: #eee; padding: 10px; border: 1px solid #555; border-radius: 5px;">
                    <h3 style="border-bottom: 2px solid #a00; margin-bottom: 8px; font-family:'Signika';">⚔️ Encounter Triggered!</h3>
                    <p>The party is interrupted in the <b>${terrainType.toUpperCase()}</b>.</p>
                    <div style="display: flex; gap: 5px; flex-direction: column;">
                        ${tableBtn}
                        ${mapBtn}
                    </div>
                </div>
            `
        });
    }
}

// --- CHAT LISTENERS (The Interactive Part) ---
Hooks.on("renderChatMessage", (app, html, data) => {
    // 1. Activate specific Scene
    html.find("button[data-action='activate-scene']").click(ev => {
        const sceneId = ev.currentTarget.dataset.sceneId;
        const scene = game.scenes.get(sceneId);
        if (scene) scene.view();
    });
    
    // 2. Roll specific Table
    html.find("button[data-action='roll-table']").click(ev => {
        const tableId = ev.currentTarget.dataset.tableId;
        const table = game.tables.get(tableId);
        if (table) table.draw();
    });

    // 3. Manual SCENE Selector (Fallback)
    html.find("button[data-action='manual-scene']").click(ev => {
        const terrain = ev.currentTarget.dataset.terrain;
        
        // Build options list of ALL scenes
        let options = game.scenes.map(s => `<option value="${s.id}">${s.name}</option>`).join("");
        
        new Dialog({
            title: `Select Map for ${terrain}`,
            content: `<form><div class="form-group"><label>Choose Scene:</label><select id="scene-select">${options}</select></div></form>`,
            buttons: {
                go: {
                    label: "Load Map",
                    callback: (html) => {
                        const id = html.find("#scene-select").val();
                        const scene = game.scenes.get(id);
                        if (scene) scene.view();
                    }
                }
            }
        }).render(true);
    });

    // 4. Manual TABLE Selector (Fallback)
    html.find("button[data-action='manual-table']").click(ev => {
        const terrain = ev.currentTarget.dataset.terrain;
        
        let options = game.tables.map(t => `<option value="${t.id}">${t.name}</option>`).join("");
        
        new Dialog({
            title: `Select Table for ${terrain}`,
            content: `<form><div class="form-group"><label>Choose Table:</label><select id="table-select">${options}</select></div></form>`,
            buttons: {
                go: {
                    label: "Roll Table",
                    callback: (html) => {
                        const id = html.find("#table-select").val();
                        const table = game.tables.get(id);
                        if (table) table.draw();
                    }
                }
            }
        }).render(true);
    });
});

// --- HELPERS ---
function normalizeTerrain(rawName) {
    const n = rawName.toLowerCase();
    if (n.includes("road")) return "road";
    if (n.includes("swamp") || n.includes("marsh")) return "swamp";
    if (n.includes("mountain") || n.includes("hill")) return "mountain";
    if (n.includes("forest") || n.includes("wood")) return "forest";
    if (n.includes("snow") || n.includes("ice") || n.includes("tundra")) return "snow";
    if (n.includes("desert") || n.includes("sand")) return "desert";
    if (n.includes("cave") || n.includes("underdark")) return "cave";
    if (n.includes("dungeon") || n.includes("ruin")) return "dungeon";
    return "wilderness";
}

function getTerrainTag(token) {
    if (!canvas.regions) return "none";
    const point = { x: token.center.x, y: token.center.y, elevation: token.document.elevation };
    const regions = canvas.regions.placeables.filter(r => r.document && typeof r.document.testPoint === 'function' && r.document.testPoint(point));
    
    // Check specific "Terrain: X" tags first
    const terrain = regions.find(r => r.document.name.toLowerCase().startsWith("terrain:"));
    if (terrain) return terrain.document.name.split(":")[1].trim();
    
    // Fallback: check names for keywords
    const anySlow = regions.find(r => {
        const n = r.document.name.toLowerCase();
        return n.includes("swamp") || n.includes("mountain") || n.includes("difficult") || n.includes("forest");
    });
    if (anySlow) return anySlow.document.name.toLowerCase();

    return "wilderness";
}

function getPartySpeed(token) {
    return token.actor?.system?.attributes?.movement?.walk || 30;
}

function updateWidget(miles, minutes, terrain) {
    const widget = document.getElementById("travel-tracker-widget");
    if (!widget) return;
    const stateEl = widget.querySelector(".travel-state");
    const subEl = widget.querySelector(".travel-subtext");
    
    stateEl.innerText = `Travel: ${capitalize(terrain)}`;
    stateEl.style.color = "#ffd700";
    
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    subEl.innerText = `Last: ${miles.toFixed(1)}mi (${h}h ${m}m)`;

    clearTimeout(window.hudResetTimer);
    window.hudResetTimer = setTimeout(() => {
        stateEl.innerText = "Resting";
        stateEl.style.color = "#a5d6a7";
        subEl.innerText = "Weather: Stable";
    }, 5000);
}

function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
}