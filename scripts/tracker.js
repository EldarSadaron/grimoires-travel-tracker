import { MODULE_ID, registerTrackerSettings } from "./settings.js";
import { WeatherEngine } from "./weather.js";

// GLOBAL SINGLETON DEBOUNCE (Your Code)
let travelTimeout = null; 

Hooks.once("init", () => {
    registerTrackerSettings();
});

Hooks.once("ready", () => {
    // 1. Initialize Weather
    if (game.settings.get(MODULE_ID, "enableWeather")) {
        globalThis.GrimoireWeather = new WeatherEngine();
    }

    // 2. Inject HUD Widget
    setTimeout(initTracker, 1000);
});

function initTracker() {
    const hudElement = document.getElementById("grimoire-hud");
    if (!hudElement) return;
    if (document.getElementById("travel-tracker-widget")) return;

    const travelDiv = document.createElement("div");
    travelDiv.id = "travel-tracker-widget";
    travelDiv.classList.add("hud-section", "travel-section");
    
    // Default "Resting" State
    travelDiv.innerHTML = `
        <span class="travel-icon">⛺</span>
        <div class="travel-data">
            <span class="travel-state">Resting</span>
            <span class="travel-subtext">Weather: Stable</span>
        </div>
    `;

    // Insert at the top of the content box
    const box = hudElement.querySelector(".hud-box .hud-content");
    if (box) box.insertBefore(travelDiv, box.firstChild);
}

// --- MAIN TRAVEL LOGIC (From travel_v2.js) ---
Hooks.on("updateToken", (tokenDoc, changes) => {
    if ((!changes.x && !changes.y) || !game.user.isGM) return;

    // Filter: Only run on the "World Map" scene (Defined in Settings)
    const targetSceneId = game.settings.get(MODULE_ID, "worldMapScene");
    if (targetSceneId !== "all" && tokenDoc.parent.id !== targetSceneId) return;

    // YOUR DEBOUNCE LOGIC
    if (travelTimeout) clearTimeout(travelTimeout);
    
    travelTimeout = setTimeout(() => {
        runMoveLogic(tokenDoc.object);
        travelTimeout = null;
    }, 1000); // 1 Second delay to wait for drag to finish
});

async function runMoveLogic(token) {
    if (!token || !token.actor) return;

    const WALKING_SPEED = 3; // MPH
    const ENCOUNTER_CHANCE = 18; // 1-20 Roll

    // 1. Distance Calculation (Your Math)
    // We use token.document.getFlag to be safe
    const lastX = token.document.getFlag(MODULE_ID, "lastX") || token.x;
    const lastY = token.document.getFlag(MODULE_ID, "lastY") || token.y;
    
    // Euclidean distance in pixels
    const distPixels = Math.hypot(token.x - lastX, token.y - lastY);
    
    // Ignore micro-adjustments
    if (distPixels < canvas.grid.size) return;

    // Update Flag FIRST to prevent loops
    await token.document.setFlag(MODULE_ID, "lastX", token.x);
    await token.document.setFlag(MODULE_ID, "lastY", token.y);

    // Convert to Miles (Grid Distance)
    const distMiles = (distPixels / canvas.scene.grid.size) * canvas.scene.grid.distance;

    // 2. Time Calculation
    let rawMinutes = (distMiles / WALKING_SPEED) * 60;
    
    // 3. Terrain Modifiers (Using V13 Region Check)
    const currentTerrain = getTerrainTag(token);
    
    // Apply multipliers based on terrain keywords
    if (currentTerrain.includes("difficult") || currentTerrain.includes("swamp") || currentTerrain.includes("mountain")) {
        rawMinutes *= 2; 
    } else if (currentTerrain.includes("road")) {
        rawMinutes *= 0.75; 
    }

    const minutesPassed = Math.max(10, Math.ceil(rawMinutes / 10) * 10); // Round to 10m

    // 4. Action: Advance Time (if moved > 0.1 miles)
    if (distMiles > 0.1) {
        await game.time.advance(minutesPassed * 60);
        
        // 5. Action: Trigger Weather Check
        let weatherChanged = false;
        if (globalThis.GrimoireWeather) {
            weatherChanged = await globalThis.GrimoireWeather.handleTimeChange(minutesPassed);
        }
        
        // 6. Action: Visual Update (Scorched Earth)
        const lastTerrain = token.document.getFlag(MODULE_ID, "lastTerrain") || "none";
        if (currentTerrain !== lastTerrain || weatherChanged) {
            if (globalThis.GrimoireWeather) {
                await globalThis.GrimoireWeather.applyWeather(game.settings.get(MODULE_ID, "weatherState").type);
            }
            await token.document.setFlag(MODULE_ID, "lastTerrain", currentTerrain);
        }

        // 7. Action: Update HUD (NEW)
        updateWidget(distMiles, minutesPassed, currentTerrain);
        
        // 8. Action: Encounter Check (Your Logic)
        const roll = Math.floor(Math.random() * 20) + 1;
        if (roll >= ENCOUNTER_CHANCE) {
            ui.notifications.warn(`⚔️ ENCOUNTER TRIGGERED in [${currentTerrain}]`);
            // You can re-enable the table draw logic here if you have the tables set up
        }
    }
}

// V13 SAFE REGION CHECK (From travel_v2.js)
function getTerrainTag(token) {
    if (!canvas.regions) return "none";
    
    const point = { x: token.center.x, y: token.center.y, elevation: token.document.elevation };
    
    const regions = canvas.regions.placeables.filter(r => {
        if (!r.document) return false;
        // The Critical V13 Fix
        return typeof r.document.testPoint === 'function' ? r.document.testPoint(point) : false;
    });

    // Look for tags like "Terrain: Swamp"
    const terrain = regions.find(r => r.document.name.startsWith("Terrain:"));
    if (terrain) return "terrain_" + terrain.document.name.split(":")[1].trim().toLowerCase();
    
    return "terrain_road"; // Default fallback
}

function updateWidget(miles, minutes, terrain) {
    const widget = document.getElementById("travel-tracker-widget");
    if (!widget) return;

    const stateEl = widget.querySelector(".travel-state");
    const subEl = widget.querySelector(".travel-subtext");

    let label = "Traveling";
    if (terrain.includes("road")) label = "Fast Pace (Road)";
    else if (terrain.includes("swamp")) label = "Slogging (Swamp)";

    stateEl.innerText = label;
    stateEl.style.color = "#ffd700"; // Active Gold
    
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    subEl.innerText = `Last: ${miles.toFixed(1)}mi (${h}h ${m}m)`;

    // Auto-Reset
    clearTimeout(window.hudResetTimer);
    window.hudResetTimer = setTimeout(() => {
        stateEl.innerText = "Resting";
        stateEl.style.color = "#a5d6a7";
        subEl.innerText = "Weather: Stable";
    }, 4000);
}