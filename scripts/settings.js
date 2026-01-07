export const MODULE_ID = "grimoires-travel-tracker";

export function registerTrackerSettings() {
    // --- TRAVEL SETTINGS ---
    const getScenes = () => {
        if (!game.scenes) return {};
        return game.scenes.reduce((acc, s) => {
            acc[s.id] = s.name;
            return acc;
        }, { "all": "All Scenes (Debug)" });
    };

    game.settings.register(MODULE_ID, "worldMapScene", {
        name: "World Map Scene",
        hint: "Travel logic will ONLY run on this scene.",
        scope: "world",
        config: true,
        type: String,
        choices: getScenes,
        default: "all"
    });

    game.settings.register(MODULE_ID, "systemRules", {
        name: "Game System",
        hint: "Determines travel pace math.",
        scope: "world",
        config: true,
        type: String,
        choices: { "dnd5e": "D&D 5e", "pf2e": "Pathfinder 2e", "custom": "Simple (30ft = 3mph)" },
        default: "dnd5e"
    });

    // --- WEATHER SETTINGS (From Living Barovia Code) ---
    game.settings.register(MODULE_ID, "enableWeather", {
        name: "Enable Weather Engine",
        scope: "world",
        config: true,
        type: Boolean,
        default: true
    });

    game.settings.register(MODULE_ID, "weatherStability", {
        name: "Weather Stability (0-1)",
        hint: "Higher = Less Frequent Changes.",
        scope: "world",
        config: true,
        type: Number,
        default: 0.6
    });

    // Hidden state tracker
    game.settings.register(MODULE_ID, "weatherState", {
        scope: "world",
        config: false,
        type: Object,
        default: { type: "Overcast" }
    });
}