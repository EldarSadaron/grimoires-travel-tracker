import { MODULE_ID, registerTrackerSettings } from "./settings.js";
import { WeatherEngine } from "./weather.js";

// Global Singleton Debounce (As per your V13 notes)
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

// --- MAIN TRAVEL LOGIC (Ported from travel_v2.js) ---
Hooks.on("updateToken", (tokenDoc, changes) => {
    if ((!changes.x && !changes.y) || !game.user.isGM) return;

    // Filter: Only run on World Map Scene
    const targetSceneId = game.settings.get(MODULE_ID, "worldMapScene");
    if (targetSceneId !== "all" && tokenDoc.parent.id !== targetSceneId) return;

    // GLOBAL SINGLETON DEBOUNCE 
    if (travelTimeout) clearTimeout(travelTimeout);
    
    travelTimeout = setTimeout(() => {
        runMoveLogic(tokenDoc.object);
        travelTimeout = null;
    }, 1000); // 1 Second delay to wait for drag to finish
});

async function runMoveLogic(token) {
    if (!token || !token.actor) return;

    // 1. Calculate Distance
    const lastX = token.document.getFlag(MODULE_ID, "lastX") || token.x;
    const lastY = token.document.getFlag(MODULE_ID, "lastY") || token.y;
    
    // Euclidean distance in pixels
    const distPixels = Math.hypot(token.x - lastX, token.y - lastY);
    
    // Ignore micro-adjustments
    if (distPixels < canvas.grid.size) return;

    // Save new position
    await token.document.setFlag(MODULE_ID, "lastX", token.x);
    await token.document.setFlag(MODULE_ID, "lastY", token.y);

    // Convert to Miles (Grid Distance)
    const distMiles = (distPixels / canvas.scene.grid.size) * canvas.scene.grid.distance;

    // 2. Calculate Speed (Slowest Member)
    const speed = getPartySpeed(token); // Feet per round
    const mph = speed / 10; // D&D 5e Standard: 30ft = 3mph
    
    // 3. Calculate Time
    // miles / mph = hours. * 60 = minutes.
    let rawMinutes = (distMiles / mph) * 60;
    
    // 4. Terrain Modifiers (V13 Region Check)
    const terrain = getTerrainTag(token);
    if (terrain.includes("difficult") || terrain.includes("swamp") || terrain.includes("mountain")) {
        rawMinutes *= 2; // Double time for difficult terrain
    } else if (terrain.includes("road")) {
        rawMinutes *= 0.75; // Faster on roads
    }

    const minutesPassed = Math.max(10, Math.ceil(rawMinutes / 10) * 10);

    // 5. Action: Advance Time
    if (distMiles > 0.1) {
        await game.time.advance(minutesPassed * 60);
        
        // 6. Action: Trigger Weather Check
        if (globalThis.GrimoireWeather) {
            await globalThis.GrimoireWeather.handleTimeChange(minutesPassed);
        }
        
        // 7. Action: Update HUD Widget
        updateWidget(distMiles, minutesPassed, terrain);
    }
}

// V13 Safe Region Check 
function getTerrainTag(token) {
    if (!canvas.regions) return "none";
    
    const point = { x: token.center.x, y: token.center.y, elevation: token.document.elevation };
    
    // Find all regions containing the token center
    const regions = canvas.regions.placeables.filter(r => {
        if (!r.document) return false;
        // Use the V13 API: RegionDocument.testPoint
        return typeof r.document.testPoint === 'function' ? r.document.testPoint(point) : false;
    });

    // Look for tags like "Terrain: Swamp"
    const terrain = regions.find(r => r.document.name.startsWith("Terrain:"));
    if (terrain) return terrain.document.name.toLowerCase();
    
    return "wilderness";
}

function getPartySpeed(token) {
    // Future expansion: If token is a "Group Token", look up the actors inside.
    // For now, check the single actor's walk speed.
    const actor = token.actor;
    if (!actor) return 30;

    const rules = game.settings.get(MODULE_ID, "systemRules");
    
    if (rules === "dnd5e") {
        return actor.system.attributes?.movement?.walk || 30;
    }
    // Add PF2e logic here if needed
    return 30;
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
    
    // Format: "3.5 mi (4h 20m)"
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    subEl.innerText = `Dist: ${miles.toFixed(1)}mi | Time: ${h}h ${m}m`;

    // Auto-Reset
    clearTimeout(window.hudResetTimer);
    window.hudResetTimer = setTimeout(() => {
        stateEl.innerText = "Resting";
        stateEl.style.color = "#a5d6a7";
        subEl.innerText = "Weather: Stable";
    }, 4000);
}