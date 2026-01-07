import { MODULE_ID } from "./settings.js";

export class WeatherEngine {
    constructor() {
        console.log("Grimoire Tracker | ⛈️ Weather Engine Online.");
        // Listen for time advancement to change weather dynamically
        Hooks.on("updateWorldTime", (totalTime, dt) => this.handleTimeChange(dt));
    }

    async handleTimeChange(minutesPassed) {
        if (!game.user.isGM) return false;
        if (!game.settings.get(MODULE_ID, "enableWeather")) return false;

        const stability = game.settings.get(MODULE_ID, "weatherStability");
        // Your formula: Chance increases as stability decreases
        const changeChance = (minutesPassed / 60) * (1 - stability);

        if (Math.random() > changeChance) return false;

        // Simple Weather Table (Matches your V2 logic)
        const roll = Math.floor(Math.random() * 20) + 1;
        let newType = "Overcast";
        
        if (roll <= 10) newType = "Overcast";
        else if (roll <= 14) newType = "Precipitation"; // Rain/Snow
        else if (roll <= 17) newType = "Fog";
        else if (roll <= 19) newType = "Storm";
        else newType = "Clear"; // Replaced "Pale Light" with generic "Clear" for now

        const current = game.settings.get(MODULE_ID, "weatherState");
        if (current.type !== newType) {
            await game.settings.set(MODULE_ID, "weatherState", { type: newType });
            
            // Notify GM
            ChatMessage.create({
                content: `<em style="color:#4a0404; font-family:serif;">The sky shifts... it is now <b>${newType}</b>.</em>`,
                whisper: ChatMessage.getWhisperRecipients("GM")
            });

            this.applyWeather(newType);
            
            // Update the HUD Widget directly
            const widget = document.getElementById("travel-tracker-widget");
            if (widget) widget.querySelector(".travel-subtext").innerText = `Weather: ${newType}`;
            
            return true;
        }
        return false;
    }

    async applyWeather(type) {
        if (!game.modules.get("fxmaster")?.active || !canvas.scene) return;

        // --- SCORCHED EARTH PROTOCOL  ---
        await Hooks.call("fxmaster.updateParticleEffects", []);
        await Hooks.call("fxmaster.updateFilters", {});
        
        if (canvas.scene) {
            await canvas.scene.unsetFlag("fxmaster", "effects");
            await canvas.scene.unsetFlag("fxmaster", "filters");
        }

        // Logic to detect Biome via Tagger/Regions would go here
        // For now, basic mapping:
        let particleConfig = [];
        let filterConfig = {};

        switch (type) {
            case "Precipitation":
                particleConfig.push({ type: "rain", options: { density: 0.4, color: "#778899" } });
                filterConfig.gloom = { type: "color", options: { saturation: 0.6, brightness: 0.9 } };
                break;
            case "Storm":
                particleConfig.push({ type: "rain", options: { density: 1.0, speed: 1.5, color: "#6ca0dc" } });
                particleConfig.push({ type: "clouds", options: { density: 0.8, color: "#111111", speed: 0.5 } });
                filterConfig.lightning = { type: "lightning", options: { frequency: 1500, brightness: 1.2 } };
                break;
            case "Fog":
                particleConfig.push({ type: "fog", options: { density: 0.5, speed: 0.2 } });
                filterConfig.grey = { type: "color", options: { saturation: 0.2 } };
                break;
            case "Overcast":
                particleConfig.push({ type: "clouds", options: { density: 0.3, color: "#999999" } });
                break;
        }

        try {
            if (particleConfig.length > 0) await Hooks.call("fxmaster.updateParticleEffects", particleConfig);
            if (Object.keys(filterConfig).length > 0) await Hooks.call("fxmaster.updateFilters", filterConfig);
        } catch (e) { console.warn("Grimoire Weather | Update Failed:", e); }
    }
}