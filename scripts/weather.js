import { MODULE_ID } from "./settings.js";

export class WeatherEngine {
    constructor() {
        console.log("Grimoire Tracker | ⛈️ Weather Engine Online (Full FX).");
        Hooks.on("updateWorldTime", (totalTime, dt) => this.handleTimeChange(dt));
    }

    async handleTimeChange(minutesPassed) {
        if (!game.user.isGM) return false;
        
        // 1. Stability Check
        const stability = game.settings.get(MODULE_ID, "weatherStability");
        const changeChance = (minutesPassed / 60) * (1 - stability);

        if (Math.random() > changeChance) return false;

        // 2. Roll New Weather
        const roll = Math.floor(Math.random() * 20) + 1;
        let newType = "Overcast";
        
        if (roll <= 8) newType = "Clear";
        else if (roll <= 12) newType = "Overcast";
        else if (roll <= 15) newType = "Precipitation"; // Rain/Snow auto-detect?
        else if (roll <= 17) newType = "Fog";
        else if (roll <= 19) newType = "Storm";
        else newType = "Strange"; // Ash/Embers

        const current = game.settings.get(MODULE_ID, "weatherState");
        if (current.type !== newType) {
            await game.settings.set(MODULE_ID, "weatherState", { type: newType });
            
            ChatMessage.create({
                content: `<div style="border:1px solid #555; background:#222; color:#eee; padding:5px; text-align:center;">
                            <h3>Weather Shift</h3>
                            <p>The atmosphere changes to <b>${newType}</b>.</p>
                          </div>`,
                whisper: ChatMessage.getWhisperRecipients("GM")
            });

            await this.applyWeather(newType);
            this.updateHUD(newType);
            return true;
        }
        return false;
    }

    async applyWeather(type) {
        if (!game.modules.get("fxmaster")?.active) return;

        // --- SCORCHED EARTH (Reset Everything) ---
        try {
            await Hooks.call("fxmaster.updateParticleEffects", []);
            await Hooks.call("fxmaster.updateFilters", {});
            
            // V13 Safe Flag Cleaning
            if (canvas.scene) {
                if (canvas.scene.flags?.fxmaster) {
                    await canvas.scene.unsetFlag("fxmaster", "effects");
                    await canvas.scene.unsetFlag("fxmaster", "filters");
                }
            }
        } catch (e) { console.warn("Grimoire Weather | Cleanup Warning:", e); }

        // --- DEFINE NEW STATE ---
        let particles = [];
        let filters = {};
        let darkness = null; // null = don't touch

        switch (type) {
            case "Clear":
                // Slight bloom or warmth
                filters.warmth = { type: "bloom", options: { radius: 0.5, intensity: 0.2 } };
                darkness = 0.0; 
                break;

            case "Overcast":
                particles.push({ type: "clouds", options: { density: 0.3, speed: 0.2, direction: 90 } });
                filters.dim = { type: "color", options: { saturation: 0.7, brightness: 0.9 } };
                darkness = 0.2;
                break;

            case "Precipitation":
                // Logic: Is it cold? (Assume Rain for now, expand later)
                particles.push({ type: "rain", options: { density: 0.6, speed: 1.0 } });
                filters.gloom = { type: "color", options: { saturation: 0.5, brightness: 0.8 } };
                darkness = 0.4;
                break;

            case "Storm":
                particles.push({ type: "rain", options: { density: 1.0, speed: 2.0, direction: 60 } });
                particles.push({ type: "clouds", options: { density: 0.8, color: "#1a1a1a" } });
                filters.lightning = { type: "lightning", options: { frequency: 1000, brightness: 1.5 } };
                filters.darkness = { type: "color", options: { brightness: 0.6, contrast: 1.1 } };
                darkness = 0.8;
                break;

            case "Fog":
                particles.push({ type: "fog", options: { density: 0.8, speed: 0.1 } });
                filters.whiteout = { type: "color", options: { saturation: 0.1, brightness: 1.2 } };
                // Fog doesn't change darkness level, just visibility
                break;

            case "Strange":
                // Ashfall or Embers
                particles.push({ type: "embers", options: { density: 0.4, speed: 0.5 } });
                filters.sepia = { type: "oldfilm", options: { sepia: 0.6, noise: 0.2 } };
                darkness = 0.5;
                break;
        }

        // --- APPLY CHANGES ---
        try {
            if (particles.length > 0) await Hooks.call("fxmaster.updateParticleEffects", particles);
            if (Object.keys(filters).length > 0) await Hooks.call("fxmaster.updateFilters", filters);
            
            // Apply Darkness (if changed)
            if (darkness !== null && canvas.scene) {
                // Only animate darkness if it's significantly different
                if (Math.abs(canvas.scene.darkness - darkness) > 0.1) {
                    await canvas.scene.update({ darkness: darkness }, { animate: true });
                }
            }
        } catch (e) {
            console.error("Grimoire Weather | FXMaster Application Failed:", e);
        }
    }

    updateHUD(weather) {
        const widget = document.getElementById("travel-tracker-widget");
        if (widget) {
            const subEl = widget.querySelector(".travel-subtext");
            // Add emoji lookup
            const icons = { "Clear": "☀️", "Overcast": "☁️", "Precipitation": "🌧️", "Storm": "⛈️", "Fog": "🌫️", "Strange": "🌋" };
            if (subEl) subEl.innerText = `Weather: ${icons[weather] || ""} ${weather}`;
        }
    }
}