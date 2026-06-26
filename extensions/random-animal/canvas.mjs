// canvas.mjs — Random Animal canvas definition (kit config; SDK-free).

import { fileURLToPath } from "node:url";
import { userStore } from "./canvas-kit/storage.mjs";

const EXT_NAME = "random-animal";

function nid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function fileFor(domainId) {
  const safe = String(domainId).replace(/[^A-Za-z0-9._-]/g, "_") || "default";
  return userStore(EXT_NAME, `${safe}.json`);
}

const ANIMALS = [
  { emoji: "🐶", name: "Dog", fact: "A dog's nose print is unique, much like a human fingerprint." },
  { emoji: "🐱", name: "Cat", fact: "Cats spend 70% of their lives sleeping." },
  { emoji: "🐻", name: "Bear", fact: "Polar bears have black skin under their white fur." },
  { emoji: "🦊", name: "Fox", fact: "Foxes use the Earth's magnetic field to hunt prey." },
  { emoji: "🐼", name: "Panda", fact: "A newborn panda is about the size of a stick of butter." },
  { emoji: "🦁", name: "Lion", fact: "A lion's roar can be heard from 5 miles away." },
  { emoji: "🐸", name: "Frog", fact: "Some frogs can freeze solid and thaw back to life." },
  { emoji: "🐧", name: "Penguin", fact: "Emperor penguins can dive to depths of 1,800 feet." },
  { emoji: "🦉", name: "Owl", fact: "Owls can rotate their heads up to 270 degrees." },
  { emoji: "🐙", name: "Octopus", fact: "An octopus has three hearts and blue blood." },
  { emoji: "🦈", name: "Shark", fact: "Sharks have been around longer than trees." },
  { emoji: "🐢", name: "Turtle", fact: "Some turtles can breathe through their butts." },
  { emoji: "🦩", name: "Flamingo", fact: "Flamingos are born white and turn pink from their diet." },
  { emoji: "🐨", name: "Koala", fact: "Koalas sleep up to 22 hours a day." },
  { emoji: "🦜", name: "Parrot", fact: "Some parrots can live for over 80 years." },
  { emoji: "🐬", name: "Dolphin", fact: "Dolphins sleep with one eye open." },
  { emoji: "🦔", name: "Hedgehog", fact: "A hedgehog has about 5,000 to 7,000 quills." },
  { emoji: "🐝", name: "Bee", fact: "Bees can recognize human faces." },
  { emoji: "🦦", name: "Otter", fact: "Sea otters hold hands while sleeping so they don't drift apart." },
  { emoji: "🦎", name: "Lizard", fact: "Some lizards can shoot blood from their eyes as a defense." },
];

function pickRandom() {
  const a = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  return { id: nid(), ...a, rolledAt: new Date().toISOString() };
}

export const canvasConfig = {
  id: "random-animal",
  displayName: "Random Animal",
  description: "Random Animal — roll the dice to discover a random animal and a fun fact!",
  assetsDir: fileURLToPath(new URL("./web/", import.meta.url)),

  inputSchema: {
    type: "object",
    properties: {
      domain: { type: "string", description: "Logical board to open. Omit for the default." },
    },
    additionalProperties: false,
  },

  resolveDomainId: (input) => (input?.domain ? String(input.domain) : "default"),
  createInitialState: () => ({ current: null, history: [] }),
  loadState: async (domainId) => fileFor(domainId).load(null),
  saveState: async (domainId, state) => fileFor(domainId).save(state),
  statusLine: (_ctx, state) =>
    state.current
      ? `${state.current.emoji} ${state.current.name} · ${state.history.length} rolled`
      : "Roll to start!",

  actions: {
    roll: {
      description: "Roll a new random animal with a fun fact.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      handler: ({ state, set }) => {
        const animal = pickRandom();
        const history = state.current
          ? [state.current, ...(state.history ?? [])].slice(0, 50)
          : state.history ?? [];
        set({ ...state, current: animal, history });
        return { animal: `${animal.emoji} ${animal.name}`, fact: animal.fact };
      },
    },

    clear_history: {
      description: "Clear the roll history.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      handler: ({ state, set }) => {
        set({ ...state, history: [] });
        return { cleared: true };
      },
    },

    get_current: {
      description: "Return the current animal (for the agent).",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      handler: ({ state }) => {
        if (!state.current) return { summary: "No animal rolled yet." };
        return {
          animal: `${state.current.emoji} ${state.current.name}`,
          fact: state.current.fact,
        };
      },
    },
  },
};
